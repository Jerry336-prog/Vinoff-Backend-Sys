import { Visit } from "../models/Visit.js";
import { successResponse, errorResponse } from "../utils/response.js";
import { normalizeVisitorIp, visitorIdentityStage } from '../utils/visitorIdentity.js';

/**
 * Normalizes referrer or utm params into a clean source label
 */
const detectSource = (referrer = "", utmSource = "") => {
  const ref = (referrer || "").toLowerCase();
  const utm = (utmSource || "").toLowerCase();

  if (utm.includes("tiktok") || ref.includes("tiktok.com") || ref.includes("bytedance")) {
    return "TikTok";
  }
  if (utm.includes("instagram") || ref.includes("instagram.com") || ref.includes("cdninstagram")) {
    return "Instagram";
  }
  if (
    utm.includes("whatsapp") ||
    ref.includes("whatsapp.com") ||
    ref.includes("wa.me") ||
    ref.includes("api.whatsapp.com")
  ) {
    return "WhatsApp";
  }
  if (
    utm.includes("google") ||
    ref.includes("google.com") ||
    ref.includes("google.") ||
    ref.includes("googlequicksearchbox")
  ) {
    return "Google Search";
  }
  if (utm.includes("facebook") || utm.includes("fb") || ref.includes("facebook.com") || ref.includes("fb.me")) {
    return "Facebook";
  }
  if (utm.includes("twitter") || utm.includes("x.com") || ref.includes("t.co") || ref.includes("twitter.com") || ref.includes("x.com")) {
    return "X (Twitter)";
  }
  if (ref && !ref.includes("localhost") && !ref.includes("vinoff")) {
    return "Other Referral";
  }
  return "Direct / Browser";
};

/**
 * Public tracking endpoint to record a page visit or session entry
 * POST /api/analytics/track
 */
export const trackVisit = async (req, res) => {
  try {
    const {
      visitorId,
      sessionId,
      userId,
      source: clientSource,
      referrer,
      path = "/",
      landingPage,
      utmSource,
      utmMedium,
      utmCampaign,
      device,
      browser,
      os,
    } = req.body;

    if (!visitorId) {
      return errorResponse(res, 400, "visitorId is required");
    }

    const currentPath = path || "/";
    const now = new Date();
    const rawIp = normalizeVisitorIp(req.ip || req.socket?.remoteAddress);
    const identityFilter = rawIp ? { ip: rawIp } : { visitorId };

    // 1. Check if an active session already exists for this visitor
    // Either matching exact sessionId OR active within the last 30 minutes for this visitorId
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    let activeSession = null;

    if (sessionId) {
      activeSession = await Visit.findOne({ sessionId, visitorId, ...identityFilter, lastSeenAt: { $gte: thirtyMinutesAgo } });
    }

    if (!activeSession) {
      activeSession = await Visit.findOne({
        visitorId,
        ...identityFilter,
        lastSeenAt: { $gte: thirtyMinutesAgo },
      }).sort({ lastSeenAt: -1 });
    }

    // IF ACTIVE SESSION EXISTS: This is the SAME user navigating to another page!
    if (activeSession) {
      // Atomic increments retain concurrent repeat visits from the same device.
      const updatedSession = await Visit.findByIdAndUpdate(activeSession._id, {
        $set: { currentPage: currentPath, lastSeenAt: now, ...(userId && !activeSession.userId ? { userId } : {}) },
        $inc: { pageViewsCount: 1 },
        $push: { pagesVisited: { path: currentPath, visitedAt: now } },
      }, { new: true });

      return res.status(200).json({
        success: true,
        message: "Page navigation recorded in active session",
        data: {
          id: activeSession._id,
          visitorId: activeSession.visitorId,
          pageViewsCount: updatedSession.pageViewsCount,
          isNewVisitor: false,
        },
      });
    }

    // IF NO ACTIVE SESSION: New visit session
    // Determine traffic source
    let source = clientSource;
    if (!source || source === "Direct / Browser" || source === "unknown") {
      source = detectSource(referrer, utmSource);
    }

    // Different browsers on the same public IP count as the same visitor.
    const previousVisit = await Visit.exists(identityFilter);
    const isNewVisitor = !previousVisit;

    const newVisit = new Visit({
      visitorId,
      sessionId: sessionId || `sess_${Date.now()}`,
      userId: userId || null,
      source,
      referrer: referrer || "",
      landingPage: landingPage || currentPath,
      currentPage: currentPath,
      pagesVisited: [{ path: currentPath, visitedAt: now }],
      pageViewsCount: 1,
      utmSource: utmSource || "",
      utmMedium: utmMedium || "",
      utmCampaign: utmCampaign || "",
      device: device || "unknown",
      browser: browser || "Other",
      os: os || "Other",
      ip: rawIp,
      isNewVisitor,
      firstSeenAt: now,
      lastSeenAt: now,
    });

    await newVisit.save();

    return res.status(201).json({
      success: true,
      message: "New visit session started",
      data: {
        id: newVisit._id,
        visitorId: newVisit.visitorId,
        source: newVisit.source,
        isNewVisitor,
      },
    });
  } catch (error) {
    console.error("[analyticsController.trackVisit]", error);
    return res.status(200).json({ success: false, message: error.message });
  }
};

/**
 * Get comprehensive analytics summary for Admin Dashboard
 * GET /api/admin/analytics
 */
export const getAnalyticsSummary = async (req, res, next) => {
  try {
    const { period = "7d" } = req.query;

    const now = new Date();
    let startDate = new Date();

    if (period === "24h") {
      startDate.setHours(startDate.getHours() - 24);
    } else if (period === "7d") {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === "30d") {
      startDate.setDate(startDate.getDate() - 30);
    } else if (period === "90d") {
      startDate.setDate(startDate.getDate() - 90);
    } else {
      startDate = new Date(2020, 0, 1);
    }

    const requestedStart = req.query.startDate ? new Date(req.query.startDate) : startDate;
    const requestedEnd = req.query.endDate ? new Date(req.query.endDate) : now;
    if (!Number.isFinite(requestedStart.getTime()) || !Number.isFinite(requestedEnd.getTime()) || requestedStart > requestedEnd) {
      return errorResponse(res, 400, "Choose a valid analytics date range.");
    }
    const matchFilter = { createdAt: { $gte: requestedStart, $lte: requestedEnd } };

    // 1. Total Pageviews, Unique Visitors, Total Sessions, and New Visitors
    const [visitorTotals, totalSessions] = await Promise.all([
      Visit.aggregate([
        { $match: matchFilter },
        visitorIdentityStage,
        { $group: { _id: '$visitorKey', totalViews: { $sum: '$pageViewsCount' }, isNew: { $max: '$isNewVisitor' } } },
      ]),
      Visit.distinct("sessionId", matchFilter),
    ]);

    const totalPageviews = visitorTotals.reduce((total, visitor) => total + visitor.totalViews, 0);
    const uniqueVisitors = visitorTotals.length;
    const totalSessionsCount = totalSessions.length;
    const newVisitorsCount = visitorTotals.filter(visitor => visitor.isNew).length;
    const returningVisitorsCount = visitorTotals.filter(visitor => visitor.totalViews > 1).length;

    // 2. Traffic Sources Breakdown (by views & unique devices)
    const sourcesAgg = await Visit.aggregate([
      { $match: matchFilter },
      visitorIdentityStage,
      {
        $group: {
          _id: "$source",
          views: { $sum: "$pageViewsCount" },
          uniqueVisitors: { $addToSet: "$visitorKey" },
        },
      },
      {
        $project: {
          source: "$_id",
          count: "$views",
          uniqueVisitorsCount: { $size: "$uniqueVisitors" },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const allSourceCategories = [
      "TikTok",
      "Instagram",
      "WhatsApp",
      "Google Search",
      "Facebook",
      "X (Twitter)",
      "Direct / Browser",
      "Other Referral",
    ];

    const sourceMap = {};
    sourcesAgg.forEach((s) => {
      sourceMap[s.source] = s;
    });

    const sources = allSourceCategories.map((name) => {
      const data = sourceMap[name] || { count: 0, uniqueVisitorsCount: 0 };
      const percentage = totalPageviews > 0 ? ((data.count / totalPageviews) * 100).toFixed(1) : 0;
      return {
        name,
        count: data.count,
        uniqueVisitors: data.uniqueVisitorsCount,
        percentage: Number(percentage),
      };
    });

    // 3. Device Breakdown
    const deviceAgg = await Visit.aggregate([
      { $match: matchFilter },
      { $group: { _id: "$device", count: { $sum: "$pageViewsCount" } } },
      { $sort: { count: -1 } },
    ]);

    const devices = deviceAgg.map((d) => ({
      device: d._id || "unknown",
      count: d.count,
      percentage: totalPageviews > 0 ? Number(((d.count / totalPageviews) * 100).toFixed(1)) : 0,
    }));

    // 4. Browser Breakdown
    const browserAgg = await Visit.aggregate([
      { $match: matchFilter },
      { $group: { _id: "$browser", count: { $sum: "$pageViewsCount" } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);

    const browsers = browserAgg.map((b) => ({
      browser: b._id || "Other",
      count: b.count,
      percentage: totalPageviews > 0 ? Number(((b.count / totalPageviews) * 100).toFixed(1)) : 0,
    }));

    // 5. Top Visited Pages (Aggregated across all pagesVisited in journeys)
    const topPagesAgg = await Visit.aggregate([
      { $match: matchFilter },
      { $unwind: "$pagesVisited" },
      { $group: { _id: "$pagesVisited.path", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    const topPages = topPagesAgg.map((p) => ({
      path: p._id || "/",
      count: p.count,
    }));

    // 6. Timeline Data
    let timelineGroupFormat;
    if (period === "24h") {
      timelineGroupFormat = {
        year: { $year: { date: "$createdAt", timezone: "Africa/Lagos" } },
        month: { $month: { date: "$createdAt", timezone: "Africa/Lagos" } },
        day: { $dayOfMonth: { date: "$createdAt", timezone: "Africa/Lagos" } },
        hour: { $hour: { date: "$createdAt", timezone: "Africa/Lagos" } },
      };
    } else {
      timelineGroupFormat = {
        year: { $year: { date: "$createdAt", timezone: "Africa/Lagos" } },
        month: { $month: { date: "$createdAt", timezone: "Africa/Lagos" } },
        day: { $dayOfMonth: { date: "$createdAt", timezone: "Africa/Lagos" } },
      };
    }

    const timelineAgg = await Visit.aggregate([
      { $match: matchFilter },
      visitorIdentityStage,
      {
        $group: {
          _id: timelineGroupFormat,
          views: { $sum: "$pageViewsCount" },
          visitors: { $addToSet: "$visitorKey" },
        },
      },
      {
        $project: {
          _id: 1,
          views: 1,
          visitorsCount: { $size: "$visitors" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.hour": 1 } },
    ]);

    const timeline = timelineAgg.map((t) => {
      let label = "";
      if (period === "24h") {
        label = `${String(t._id.hour).padStart(2, "0")}:00`;
      } else {
        label = `${t._id.month}/${t._id.day}`;
      }
      return {
        label,
        date: `${t._id.year}-${String(t._id.month).padStart(2, "0")}-${String(t._id.day).padStart(2, "0")}`,
        views: t.views,
        visitors: t.visitorsCount,
      };
    });

    // 7. Recent Visitor Stream (Latest 30 visitor sessions with pages browsed)
    const recentVisitorGroups = await Visit.aggregate([
      { $match: matchFilter },
      visitorIdentityStage,
      { $sort: { lastSeenAt: -1, _id: -1 } },
      { $group: { _id: '$visitorKey', latest: { $first: '$$ROOT' }, totalViews: { $sum: '$pageViewsCount' }, sessions: { $sum: 1 }, firstSeen: { $min: '$createdAt' } } },
      { $sort: { 'latest.lastSeenAt': -1 } },
      { $limit: 30 },
      { $lookup: { from: 'users', localField: 'latest.userId', foreignField: '_id', pipeline: [{ $project: { firstName: 1, lastName: 1, email: 1, role: 1 } }], as: 'user' } },
    ]);
    const recentVisits = recentVisitorGroups.map(group => ({ ...group.latest, pageViewsCount: group.totalViews, sessionCount: group.sessions, firstSeenAt: group.firstSeen, userId: group.user[0] || null }));

    const formattedRecentVisits = recentVisits.map((v) => {
      const journey = Array.isArray(v.pagesVisited) && v.pagesVisited.length > 0
        ? v.pagesVisited.map((p) => p.path)
        : [v.landingPage || v.currentPage || "/"];

      return {
        id: v._id,
        visitorId: v.visitorId,
        ip: normalizeVisitorIp(v.ip),
        sessionCount: v.sessionCount,
        source: v.source,
        landingPage: v.landingPage || "/",
        currentPage: v.currentPage || v.path || v.landingPage || "/",
        path: v.currentPage || v.path || v.landingPage || "/",
        pagesVisited: journey,
        pageViewsCount: v.pageViewsCount || journey.length,
        device: v.device,
        browser: v.browser,
        os: v.os,
        referrer: v.referrer,
        isNewVisitor: v.isNewVisitor,
        user: v.userId
          ? {
              name: `${v.userId.firstName || ""} ${v.userId.lastName || ""}`.trim() || "User",
              email: v.userId.email,
              role: v.userId.role,
            }
          : null,
        createdAt: v.createdAt,
        lastSeenAt: v.lastSeenAt || v.createdAt,
      };
    });

    return successResponse(res, 200, "Analytics retrieved successfully", {
      period,
      summary: {
        totalPageviews,
        totalViews: uniqueVisitors,
        countingMethod: 'unique-ip',
        uniqueVisitors,
        totalSessions: totalSessionsCount,
        newVisitorsCount,
        returningVisitorsCount,
      },
      sources,
      devices,
      browsers,
      topPages,
      timeline,
      recentVisits: formattedRecentVisits,
    });
  } catch (error) {
    next(error);
  }
};

export default {
  trackVisit,
  getAnalyticsSummary,
};

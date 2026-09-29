import { Visit } from "../models/Visit.js";
import { successResponse, errorResponse } from "../utils/response.js";

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
      path,
      landingPage,
      utmSource,
      utmMedium,
      utmCampaign,
      device,
      browser,
      os,
    } = req.body;

    if (!visitorId || !sessionId) {
      return errorResponse(res, 400, "visitorId and sessionId are required");
    }

    // Determine traffic source
    let source = clientSource;
    if (!source || source === "Direct / Browser" || source === "unknown") {
      source = detectSource(referrer, utmSource);
    }

    // Extract IP (anonymized for basic network analysis)
    const rawIp =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "";

    // Check if this visitor has visited before
    const previousVisit = await Visit.exists({ visitorId });
    const isNewVisitor = !previousVisit;

    const visit = new Visit({
      visitorId,
      sessionId,
      userId: userId || null,
      source,
      referrer: referrer || "",
      path: path || "/",
      landingPage: landingPage || path || "/",
      utmSource: utmSource || "",
      utmMedium: utmMedium || "",
      utmCampaign: utmCampaign || "",
      device: device || "unknown",
      browser: browser || "Other",
      os: os || "Other",
      ip: rawIp,
      isNewVisitor,
    });

    await visit.save();

    return res.status(201).json({
      success: true,
      message: "Visit recorded",
      data: { id: visit._id, source },
    });
  } catch (error) {
    console.error("[analyticsController.trackVisit]", error);
    // Return 200 with error flag to never break frontend analytics requests
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
      // All time: default to 1 year back
      startDate = new Date(2020, 0, 1);
    }

    const matchFilter = { createdAt: { $gte: startDate, $lte: now } };

    // 1. Total Pageviews & Distinct Counts
    const [totalPageviews, uniqueVisitors, totalSessions, newVisitorsCount] = await Promise.all([
      Visit.countDocuments(matchFilter),
      Visit.distinct("visitorId", matchFilter).then((ids) => ids.length),
      Visit.distinct("sessionId", matchFilter).then((ids) => ids.length),
      Visit.countDocuments({ ...matchFilter, isNewVisitor: true }),
    ]);

    // 2. Traffic Sources Breakdown
    const sourcesAgg = await Visit.aggregate([
      { $match: matchFilter },
      { $group: { _id: "$source", count: { $sum: 1 }, uniqueVisitors: { $addToSet: "$visitorId" } } },
      {
        $project: {
          source: "$_id",
          count: 1,
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
      { $group: { _id: "$device", count: { $sum: 1 } } },
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
      { $group: { _id: "$browser", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);

    const browsers = browserAgg.map((b) => ({
      browser: b._id || "Other",
      count: b.count,
      percentage: totalPageviews > 0 ? Number(((b.count / totalPageviews) * 100).toFixed(1)) : 0,
    }));

    // 5. Top Landing Pages
    const topPagesAgg = await Visit.aggregate([
      { $match: matchFilter },
      { $group: { _id: "$path", count: { $sum: 1 } } },
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
        year: { $year: "$createdAt" },
        month: { $month: "$createdAt" },
        day: { $dayOfMonth: "$createdAt" },
        hour: { $hour: "$createdAt" },
      };
    } else {
      timelineGroupFormat = {
        year: { $year: "$createdAt" },
        month: { $month: "$createdAt" },
        day: { $dayOfMonth: "$createdAt" },
      };
    }

    const timelineAgg = await Visit.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: timelineGroupFormat,
          views: { $sum: 1 },
          visitors: { $addToSet: "$visitorId" },
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
        views: t.views,
        visitors: t.visitorsCount,
      };
    });

    // 7. Recent Visitor Feed (Last 30 visits)
    const recentVisits = await Visit.find(matchFilter)
      .sort({ createdAt: -1 })
      .limit(30)
      .populate("userId", "firstName lastName email role")
      .lean();

    const formattedRecentVisits = recentVisits.map((v) => ({
      id: v._id,
      visitorId: v.visitorId,
      source: v.source,
      path: v.path,
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
    }));

    return successResponse(res, 200, "Analytics retrieved successfully", {
      period,
      summary: {
        totalPageviews,
        uniqueVisitors,
        totalSessions,
        newVisitorsCount,
        returningVisitorsCount: Math.max(0, uniqueVisitors - newVisitorsCount),
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

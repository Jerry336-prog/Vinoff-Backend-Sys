export const prepareReorder = (order, products) => {
  const productMap = new Map(products.map(product => [String(product._id), product]));
  const grouped = new Map();
  const notices = [];
  for (const item of order.items || []) {
    const id = String(item.product?._id || item.product || '');
    const product = productMap.get(id);
    const isCarton = item.isCarton !== false && !['pieces', 'units'].includes(item.unitType || item.unit);
    if (!product || product.status !== 'active' || (isCarton ? product.allowCarton === false : product.allowPieces === false)) {
      notices.push(`${item.name || 'An item'} is no longer available in this format.`); continue;
    }
    const key = `${id}:${isCarton}`;
    const entry = grouped.get(key) || { product, quantity: 0, isCarton };
    entry.quantity += Number(item.quantity || 0);
    grouped.set(key, entry);
  }
  const items = [];
  for (const { product, quantity, isCarton } of grouped.values()) {
    const stock = Math.max(0, Math.floor(Number(product[isCarton ? 'stock' : 'unitStock'] || 0)));
    const allowed = Math.min(quantity, stock);
    if (allowed < quantity) notices.push(`${product.name}: ${allowed ? `quantity reduced to ${allowed}` : 'out of stock'} (${isCarton ? 'cartons' : 'units'}).`);
    if (!allowed) continue;
    const cartonPrice = Number(product.wholesalePrice || product.price || 0);
    const unitsPerCarton = Number(product.unitsPerCarton || product.minimumQuantity || 12);
    const unitPrice = Number(product.piecePrice || product.unitPrice || Math.round(cartonPrice / unitsPerCarton));
    items.push({ id: String(product._id), name: product.name, image: product.images?.[0]?.url || '/VinoffLogo.webp', category: product.category, cartonPrice, unitPrice, unitsPerCarton, quantity: allowed, isCarton });
  }
  return { items, notices, message: 'Current prices and availability applied. Review your cart before checkout.' };
};

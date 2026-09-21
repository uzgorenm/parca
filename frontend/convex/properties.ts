import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listProperties = query({
    handler: async (ctx) => {
        const properties = await ctx.db.query("properties").collect();
        return Promise.all(
            properties.map(async (p) => {
                const specs = await ctx.db
                    .query("property_specs")
                    .withIndex("by_property_id", (q) => q.eq("property_id", p._id))
                    .unique();
                const media = await ctx.db
                    .query("property_media")
                    .withIndex("by_property_id", (q) => q.eq("property_id", p._id))
                    .collect();

                // Last executed trade price (most accurate market price)
                const lastTrade = await ctx.db
                    .query("trades")
                    .withIndex("by_propertyId", (q) => q.eq("propertyId", p._id))
                    .order("desc")
                    .first();

                // Best Ask as fallback
                const bestAsk = await ctx.db
                    .query("orders")
                    .withIndex("by_property_status_side_price_timestamp", (q) =>
                        q.eq("propertyId", p._id).eq("status", "open").eq("side", "sell")
                    )
                    .first();

                const openAsks = await ctx.db
                    .query("orders")
                    .withIndex("by_property_status_side_price_timestamp", (q) =>
                        q.eq("propertyId", p._id).eq("status", "open").eq("side", "sell")
                    )
                    .collect();
                const availableShares = openAsks.reduce((acc, o) => acc + o.quantity, 0);

                const pricePerShare = lastTrade?.price ?? bestAsk?.price;

                return {
                    ...p,
                    specs,
                    media,
                    valuation: { price_per_share: pricePerShare || 0 },
                    pricePerShare,
                    availableShares,
                    lastTradePrice: lastTrade?.price,
                };
            })
        );
    },
});

export const getProperty = query({
    args: { id: v.id("properties") },
    handler: async (ctx, args) => {
        const property = await ctx.db.get(args.id);
        if (!property) return null;

        const specs = await ctx.db
            .query("property_specs")
            .withIndex("by_property_id", (q) => q.eq("property_id", property._id))
            .unique();
        const media = await ctx.db
            .query("property_media")
            .withIndex("by_property_id", (q) => q.eq("property_id", property._id))
            .collect();

        // Last executed trade price
        const lastTrade = await ctx.db
            .query("trades")
            .withIndex("by_propertyId", (q) => q.eq("propertyId", property._id))
            .order("desc")
            .first();

        // Best Ask (Lowest Sell Order)
        const bestAsk = await ctx.db
            .query("orders")
            .withIndex("by_property_status_side_price_timestamp", (q) =>
                q.eq("propertyId", property._id).eq("status", "open").eq("side", "sell")
            )
            .first();

        // Best Bid (Highest Buy Order)
        const bestBid = await ctx.db
            .query("orders")
            .withIndex("by_property_status_side_price_timestamp", (q) =>
                q.eq("propertyId", property._id).eq("status", "open").eq("side", "buy")
            )
            .order("desc")
            .first();

        const openAsks = await ctx.db
            .query("orders")
            .withIndex("by_property_status_side_price_timestamp", (q) =>
                q.eq("propertyId", property._id).eq("status", "open").eq("side", "sell")
            )
            .collect();
        const availableShares = openAsks.reduce((acc, o) => acc + o.quantity, 0);

        const identity = await ctx.auth.getUserIdentity();
        let userHoldings = 0;
        if (identity) {
            const holding = await ctx.db
                .query("user_holdings")
                .withIndex("by_userId_property", (q) => q.eq("userId", identity.subject).eq("propertyId", property._id))
                .unique();
            userHoldings = (holding?.availableQuantity || 0) + (holding?.lockedQuantity || 0);
        }

        const pricePerShare = lastTrade?.price ?? bestAsk?.price;

        return {
            ...property,
            specs,
            media,
            pricePerShare,
            lastTradePrice: lastTrade?.price,
            bestAsk: bestAsk?.price,
            bestBid: bestBid?.price,
            availableShares,
            userHoldings,
        };
    },
});

export const searchProperties = query({
    args: {
        minLat: v.optional(v.number()),
        maxLat: v.optional(v.number()),
        minLng: v.optional(v.number()),
        maxLng: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const properties = await ctx.db.query("properties").collect();
        const filtered = properties.filter((p) => {
            if (args.minLat !== undefined && (p.lat ?? 0) < args.minLat) return false;
            if (args.maxLat !== undefined && (p.lat ?? 0) > args.maxLat) return false;
            if (args.minLng !== undefined && (p.lng ?? 0) < args.minLng) return false;
            if (args.maxLng !== undefined && (p.lng ?? 0) > args.maxLng) return false;
            return true;
        });

        return Promise.all(
            filtered.map(async (p) => {
                const specs = await ctx.db
                    .query("property_specs")
                    .withIndex("by_property_id", (q) => q.eq("property_id", p._id))
                    .unique();
                const media = await ctx.db
                    .query("property_media")
                    .withIndex("by_property_id", (q) => q.eq("property_id", p._id))
                    .collect();

                // Last executed trade price
                const lastTrade = await ctx.db
                    .query("trades")
                    .withIndex("by_propertyId", (q) => q.eq("propertyId", p._id))
                    .order("desc")
                    .first();

                // Best Ask as fallback
                const bestAsk = await ctx.db
                    .query("orders")
                    .withIndex("by_property_status_side_price_timestamp", (q) =>
                        q.eq("propertyId", p._id).eq("status", "open").eq("side", "sell")
                    )
                    .first();

                const openAsks = await ctx.db
                    .query("orders")
                    .withIndex("by_property_status_side_price_timestamp", (q) =>
                        q.eq("propertyId", p._id).eq("status", "open").eq("side", "sell")
                    )
                    .collect();
                const availableShares = openAsks.reduce((acc, o) => acc + o.quantity, 0);

                const pricePerShare = lastTrade?.price ?? bestAsk?.price;

                return {
                    ...p,
                    specs,
                    media,
                    valuation: { price_per_share: pricePerShare || 0 },
                    pricePerShare,
                    availableShares,
                    lastTradePrice: lastTrade?.price,
                };
            })
        );
    },
});

// Removed updatePropertyPrice mutation as per requirements

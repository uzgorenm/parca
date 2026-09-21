import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    // Group 1: The Physical Asset
    properties: defineTable({
        address: v.string(),
        apn: v.string(),
        lat: v.optional(v.number()),
        lng: v.optional(v.number()),
    }).index("by_address", ["address"]),

    property_specs: defineTable({
        property_id: v.id("properties"),
        sqft: v.number(),
        bedrooms: v.number(),
        bathrooms: v.number(),
        year_built: v.optional(v.number()),
    }).index("by_property_id", ["property_id"]),

    property_media: defineTable({
        property_id: v.id("properties"),
        url: v.string(),
        type: v.union(v.literal("image"), v.literal("video"), v.literal("document")),
        label: v.optional(v.string()),
    }).index("by_property_id", ["property_id"]),

    // Group 2: The Market Data
    property_valuations: defineTable({
        property_id: v.id("properties"),
        total_appraised_value: v.number(),
        price_per_share: v.number(),
        timestamp: v.number(),
    }).index("by_property_id", ["property_id"]),

    // Group 3: The Trading Engine (Order Book)
    orders: defineTable({
        userId: v.string(),
        propertyId: v.id("properties"),
        side: v.union(v.literal("buy"), v.literal("sell")),
        type: v.union(v.literal("market"), v.literal("limit")),
        quantity: v.number(),
        price: v.optional(v.number()),
        status: v.union(v.literal("open"), v.literal("filled"), v.literal("cancelled")),
        timestamp: v.number(),
    }).index("by_property_status_side_price_timestamp", ["propertyId", "status", "side", "price", "timestamp"])
        .index("by_userId", ["userId"]),

    trades: defineTable({
        propertyId: v.id("properties"),
        buyerId: v.string(),
        sellerId: v.string(),
        quantity: v.number(),
        price: v.number(),
        timestamp: v.number(),
        buyOrderId: v.optional(v.id("orders")),
        sellOrderId: v.optional(v.id("orders")),
    }).index("by_propertyId", ["propertyId"]),

    user_holdings: defineTable({
        userId: v.string(),
        propertyId: v.id("properties"),
        availableQuantity: v.number(),
        lockedQuantity: v.number(),
        averagePrice: v.number(),
    }).index("by_userId_property", ["userId", "propertyId"])
        .index("by_propertyId", ["propertyId"]),

    users: defineTable({
        userId: v.string(),
        availableBalance: v.number(),
        lockedBalance: v.number(),
    }).index("by_userId", ["userId"]),
});

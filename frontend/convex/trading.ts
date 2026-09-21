import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Core CLOB Matching Engine
 * Implements Price-Time Priority (FIFO) matching.
 */
export const executeTrade = mutation({
    args: {
        propertyId: v.id("properties"),
        side: v.union(v.literal("buy"), v.literal("sell")),
        type: v.union(v.literal("market"), v.literal("limit")),
        quantity: v.number(),
        price: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Unauthenticated");
        const userId = identity.subject;

        if (args.type === "limit" && !args.price) {
            throw new Error("Limit orders require a price");
        }

        // 1. Get User State
        const user = await ctx.db
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .unique();

        if (!user) throw new Error("User profile not found. Please sign in again.");

        const holding = await ctx.db
            .query("user_holdings")
            .withIndex("by_userId_property", (q) =>
                q.eq("userId", userId).eq("propertyId", args.propertyId)
            )
            .unique();

        // 2. Pre-Trade Validation & Fund/Share Locking
        if (args.side === "buy") {
            if (args.type === "limit") {
                const totalCost = args.price! * args.quantity;
                if (user.availableBalance < totalCost) {
                    throw new Error(
                        "Insufficient funds. Need $" + totalCost.toFixed(2) +
                        ", have $" + user.availableBalance.toFixed(2)
                    );
                }
                await ctx.db.patch(user._id, {
                    availableBalance: user.availableBalance - totalCost,
                    lockedBalance: user.lockedBalance + totalCost,
                });
            }
            // For market buys, balance is checked per-fill in the matching loop
        } else {
            // Sell side: lock shares
            const available = holding ? holding.availableQuantity : 0;
            if (available < args.quantity) {
                throw new Error(
                    "Insufficient shares. Available: " + available.toFixed(4) +
                    "%, requested: " + args.quantity.toFixed(4) + "%"
                );
            }
            await ctx.db.patch(holding!._id, {
                availableQuantity: holding!.availableQuantity - args.quantity,
                lockedQuantity: holding!.lockedQuantity + args.quantity,
            });
        }

        // 3. Query the Opposite Side of the Order Book
        const oppositeSide = args.side === "buy" ? "sell" : "buy";
        let candidates = await ctx.db
            .query("orders")
            .withIndex("by_property_status_side_price_timestamp", (q) =>
                q.eq("propertyId", args.propertyId).eq("status", "open").eq("side", oppositeSide)
            )
            .collect();

        if (args.side === "buy") {
            // Buying: match against sell orders, lowest price first
            candidates = candidates
                .filter((o) => args.type === "market" || (args.price !== undefined && o.price !== undefined && o.price <= args.price))
                .sort((a, b) => ((a.price || 0) - (b.price || 0)) || (a.timestamp - b.timestamp));
        } else {
            // Selling: match against buy orders, highest price first
            candidates = candidates
                .filter((o) => args.type === "market" || (args.price !== undefined && o.price !== undefined && o.price >= args.price))
                .sort((a, b) => ((b.price || 0) - (a.price || 0)) || (a.timestamp - b.timestamp));
        }

        // 4. Matching Loop
        let unfilledQuantity = args.quantity;
        const now = Date.now();

        for (const counterOrder of candidates) {
            if (unfilledQuantity <= 0) break;

            const matchQty = Math.min(unfilledQuantity, counterOrder.quantity);
            const executionPrice = counterOrder.price || 0;

            const buyerId = args.side === "buy" ? userId : counterOrder.userId;
            const sellerId = args.side === "sell" ? userId : counterOrder.userId;

            // Update buyer's holdings
            const buyerHolding = await ctx.db
                .query("user_holdings")
                .withIndex("by_userId_property", (q) =>
                    q.eq("userId", buyerId).eq("propertyId", args.propertyId)
                )
                .unique();

            const fillCost = matchQty * executionPrice;

            if (buyerId === userId && args.type === "limit") {
                // Funds already locked — deduct from locked
                await ctx.db.patch(user._id, {
                    lockedBalance: user.lockedBalance - fillCost,
                });
            } else if (buyerId !== userId) {
                // Counter-party buyer (was already in market as a buy order)
                const counterBuyer = await ctx.db
                    .query("users")
                    .withIndex("by_userId", (q) => q.eq("userId", buyerId))
                    .unique();
                if (counterBuyer && counterBuyer.availableBalance >= fillCost) {
                    await ctx.db.patch(counterBuyer._id, {
                        availableBalance: counterBuyer.availableBalance - fillCost,
                    });
                }
            } else {
                // Market buy — deduct from available balance directly
                if (user.availableBalance < fillCost) {
                    throw new Error("Insufficient funds for market buy fill.");
                }
                await ctx.db.patch(user._id, {
                    availableBalance: user.availableBalance - fillCost,
                });
            }

            if (buyerHolding) {
                await ctx.db.patch(buyerHolding._id, {
                    availableQuantity: buyerHolding.availableQuantity + matchQty,
                });
            } else {
                await ctx.db.insert("user_holdings", {
                    userId: buyerId,
                    propertyId: args.propertyId,
                    availableQuantity: matchQty,
                    lockedQuantity: 0,
                    averagePrice: executionPrice,
                });
            }

            // Update seller's holdings and balance
            const sellerHolding = await ctx.db
                .query("user_holdings")
                .withIndex("by_userId_property", (q) =>
                    q.eq("userId", sellerId).eq("propertyId", args.propertyId)
                )
                .unique();

            const proceeds = matchQty * executionPrice;

            if (sellerId === userId) {
                // Our sell — shares were locked, release locked and credit balance
                await ctx.db.patch(holding!._id, {
                    lockedQuantity: holding!.lockedQuantity - matchQty,
                });
                await ctx.db.patch(user._id, {
                    availableBalance: user.availableBalance + proceeds,
                });
            } else {
                // Counter-party sell order — deduct from their locked shares, credit balance
                if (sellerHolding) {
                    await ctx.db.patch(sellerHolding._id, {
                        lockedQuantity: sellerHolding.lockedQuantity - matchQty,
                    });
                }
                const counterSeller = await ctx.db
                    .query("users")
                    .withIndex("by_userId", (q) => q.eq("userId", sellerId))
                    .unique();
                if (counterSeller) {
                    await ctx.db.patch(counterSeller._id, {
                        availableBalance: counterSeller.availableBalance + proceeds,
                    });
                }
            }

            // Mark counter-order as filled or partially filled
            if (matchQty >= counterOrder.quantity) {
                await ctx.db.patch(counterOrder._id, { status: "filled", quantity: 0 });
            } else {
                await ctx.db.patch(counterOrder._id, {
                    quantity: counterOrder.quantity - matchQty,
                });
            }

            // Log the trade
            await ctx.db.insert("trades", {
                propertyId: args.propertyId,
                buyerId,
                sellerId,
                quantity: matchQty,
                price: executionPrice,
                timestamp: now,
            });

            unfilledQuantity -= matchQty;
        }

        // 5. If unfilled quantity remains on a limit order, place it on the book
        if (unfilledQuantity > 0 && args.type === "limit") {
            await ctx.db.insert("orders", {
                userId,
                propertyId: args.propertyId,
                side: args.side,
                type: "limit",
                quantity: unfilledQuantity,
                price: args.price,
                status: "open",
                timestamp: now,
            });
        }

        const filled = args.quantity - unfilledQuantity;
        return { success: true, filled, remaining: unfilledQuantity };
    },
});
export const getHoldings = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return [];

        const holdings = await ctx.db
            .query("user_holdings")
            .withIndex("by_userId_property", (q) => q.eq("userId", identity.subject))
            .collect();

        return Promise.all(
            holdings.map(async (h) => {
                const property = await ctx.db.get(h.propertyId);
                const bestAsk = await ctx.db
                    .query("orders")
                    .withIndex("by_property_status_side_price_timestamp", (q) =>
                        q.eq("propertyId", h.propertyId).eq("status", "open").eq("side", "sell")
                    )
                    .first();

                return {
                    ...h,
                    property_id: h.propertyId,
                    shares_owned: h.availableQuantity + h.lockedQuantity,
                    address: property?.address ?? "Unknown",
                    current_price: bestAsk?.price ?? h.averagePrice,
                };
            })
        );
    },
});

export const getUserBalance = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return 0;

        const user = await ctx.db
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
            .first();
        return user?.availableBalance ?? 0;
    },
});

export const getAvailability = query({
    args: { propertyId: v.id("properties") },
    handler: async (ctx, args) => {
        const openAsks = await ctx.db
            .query("orders")
            .withIndex("by_property_status_side_price_timestamp", (q) =>
                q.eq("propertyId", args.propertyId).eq("status", "open").eq("side", "sell")
            )
            .collect();

        return openAsks.reduce((acc, order) => acc + order.quantity, 0);
    },
});

// Returns chronological trade history for a property since a given timestamp.
// Used to power the property price chart and last-trade price.
export const getPriceHistory = query({
    args: {
        propertyId: v.id("properties"),
        since: v.number(), // unix ms
    },
    handler: async (ctx, args) => {
        const trades = await ctx.db
            .query("trades")
            .withIndex("by_propertyId", (q) => q.eq("propertyId", args.propertyId))
            .collect();

        return trades
            .filter((t) => t.timestamp >= args.since)
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((t) => ({ timestamp: t.timestamp, price: t.price, quantity: t.quantity }));
    },
});

// Returns total portfolio value snapshots over time, derived from trade history.
// Each point represents the mark-to-market value of all holdings at that trade price.
export const getPortfolioHistory = query({
    args: { since: v.number() },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return [];

        const holdings = await ctx.db
            .query("user_holdings")
            .withIndex("by_userId_property", (q) => q.eq("userId", identity.subject))
            .collect();

        if (holdings.length === 0) return [];

        // Collect all trades since `since` for properties we hold
        const allTrades: { timestamp: number; propertyId: string; price: number }[] = [];
        for (const h of holdings) {
            const trades = await ctx.db
                .query("trades")
                .withIndex("by_propertyId", (q) => q.eq("propertyId", h.propertyId))
                .collect();
            for (const t of trades) {
                if (t.timestamp >= args.since) {
                    allTrades.push({ timestamp: t.timestamp, propertyId: h.propertyId as string, price: t.price });
                }
            }
        }

        if (allTrades.length === 0) return [];

        // Sort all events by timestamp and compute portfolio value at each event
        allTrades.sort((a, b) => a.timestamp - b.timestamp);

        // Track last known price per property (start with averagePrice from holdings)
        const lastPrice: Record<string, number> = {};
        for (const h of holdings) {
            lastPrice[h.propertyId as string] = h.averagePrice;
        }

        const points: { timestamp: number; value: number }[] = [];

        for (const event of allTrades) {
            lastPrice[event.propertyId] = event.price;
            const value = holdings.reduce((sum, h) => {
                const shares = h.availableQuantity + h.lockedQuantity;
                return sum + shares * (lastPrice[h.propertyId as string] || h.averagePrice);
            }, 0);
            points.push({ timestamp: event.timestamp, value });
        }

        return points;
    },
});

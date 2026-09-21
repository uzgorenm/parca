import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const syncUser = mutation({
    args: {
        clerkId: v.string(),
        email: v.string(),
        name: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Called syncUser without authentication");
        }

        const existingUser = await ctx.db
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
            .first();

        if (existingUser) {
            // Update user info if needed
            return existingUser._id;
        }

        // New user: create with initial balance
        return await ctx.db.insert("users", {
            userId: identity.subject,
            availableBalance: 50000, // Initial demo funds
            lockedBalance: 0,
        });
    },
});

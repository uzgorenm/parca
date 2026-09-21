import { mutation } from "./_generated/server";

const MOCK_PROPERTIES = [
    {
        "id": "1",
        "address": "84230 Tyler Ln",
        "price": 450000,
        "apn": "APN-111-222-333",
        "available": "10%",
        "image": "https://images.unsplash.com/photo-1570129477492-45c003edd2be?q=80&w=2070&auto=format&fit=crop",
        "description": "Modern property scenario in the heart of the city, modeled with premium finishes and a projected net rental return.",
        "yield": "4.2%",
        "appreciation": "+12% YoY",
        "specs": { "sqft": 2400, "bedrooms": 3, "bathrooms": 2 },
        "lat": 34.0522,
        "lng": -118.2437
    },
    {
        "id": "2",
        "address": "123 Ocean View",
        "price": 1200000,
        "apn": "APN-444-555-666",
        "available": "5%",
        "image": "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?q=80&w=2070&auto=format&fit=crop",
        "description": "Stunning oceanfront villa. Prime location with luxury amenities and high appreciation history.",
        "yield": "3.8%",
        "appreciation": "+15% YoY",
        "specs": { "sqft": 4500, "bedrooms": 5, "bathrooms": 4 },
        "lat": 34.0122,
        "lng": -118.4912
    },
    {
        "id": "3",
        "address": "555 Mountain Rd",
        "price": 890000,
        "apn": "APN-777-888-999",
        "available": "12%",
        "image": "https://images.unsplash.com/photo-1430285561322-7808604715df?q=80&w=2070&auto=format&fit=crop",
        "description": "Quiet mountain retreat scenario modeled with steady long-term rental occupancy.",
        "yield": "5.1%",
        "appreciation": "+8% YoY",
        "specs": { "sqft": 3200, "bedrooms": 4, "bathrooms": 3 },
        "lat": 34.1022,
        "lng": -118.3437
    }
];

export const seed = mutation({
    handler: async (ctx) => {
        const tables = [
            "properties",
            "property_specs",
            "property_media",
            "property_valuations",
            "orders",
            "trades",
            "user_holdings",
            "users"
        ] as const;

        for (const table of tables) {
            const records = await ctx.db.query(table).collect();
            for (const r of records) {
                await ctx.db.delete(r._id);
            }
        }

        await ctx.db.insert("users", {
            userId: "user_demo_123",
            availableBalance: 50000,
            lockedBalance: 0,
        });

        for (const p of MOCK_PROPERTIES) {
            const propertyId = await ctx.db.insert("properties", {
                address: p.address,
                apn: p.apn,
                lat: p.lat,
                lng: p.lng,
            });

            await ctx.db.insert("property_specs", {
                property_id: propertyId,
                sqft: p.specs.sqft,
                bedrooms: p.specs.bedrooms,
                bathrooms: p.specs.bathrooms,
            });

            await ctx.db.insert("property_media", {
                property_id: propertyId,
                url: p.image,
                type: "image",
            });

            await ctx.db.insert("property_valuations", {
                property_id: propertyId,
                total_appraised_value: p.price,
                price_per_share: p.price / 100,
                timestamp: Date.now(),
            });

            // Initial System Liquidity Order (demo)
            await ctx.db.insert("orders", {
                userId: "SYSTEM_MARKET",
                propertyId: propertyId,
                side: "sell",
                type: "limit",
                quantity: 100,
                price: p.price / 100,
                status: "open",
                timestamp: Date.now(),
            });
        }
    },
});

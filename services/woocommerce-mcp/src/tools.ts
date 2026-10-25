import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { logWooCommerceFailure, sanitizedToolError } from "./errors.js";
import { WooCommerceClient } from "./woocommerce-client.js";

const idSchema = z.number().int().min(1).max(2_147_483_647);
const pageSchema = z.number().int().min(1).max(10_000).default(1);
const perPageSchema = z.number().int().min(1).max(100).default(10);
const priceSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "must be a positive decimal with up to two places")
  .refine((value) => Number(value) > 0, "must be greater than zero");
const orderStatusSchema = z.enum(["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"]);
const productStatusSchema = z.enum(["publish", "draft", "pending", "private"]);

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Unexpected WooCommerce response.");
  }
  return value as Record<string, unknown>;
}

function productSummary(value: unknown) {
  const product = record(value);
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    status: product.status,
    type: product.type,
    regular_price: product.regular_price,
    price: product.price,
    stock_status: product.stock_status,
    permalink: product.permalink,
  };
}

function orderSummary(value: unknown) {
  const order = record(value);
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  return {
    id: order.id,
    status: order.status,
    currency: order.currency,
    total: order.total,
    date_created: order.date_created,
    date_modified: order.date_modified,
    line_items: lineItems.map((item) => {
      const lineItem = record(item);
      return {
        id: lineItem.id,
        product_id: lineItem.product_id,
        name: lineItem.name,
        quantity: lineItem.quantity,
        total: lineItem.total,
      };
    }),
  };
}

export function createWooCommerceMcpServer(client: WooCommerceClient): McpServer {
  const server = new McpServer({ name: "urumi-woocommerce-mcp", version: "0.1.0" });

  server.registerTool(
    "list_products",
    {
      description: "List WooCommerce products with bounded pagination.",
      inputSchema: z.object({
        page: pageSchema,
        per_page: perPageSchema,
        search: z.string().trim().min(1).max(100).optional(),
        status: productStatusSchema.optional(),
      }),
    },
    async ({ page, per_page, search, status }) => {
      try {
        const products = await client.listProducts({ page, per_page, search, status });
        return textResult({ products: products.map(productSummary) });
      } catch (error) {
        logWooCommerceFailure("list_products", error);
        return textResult({ error: sanitizedToolError(error) }, true);
      }
    },
  );

  server.registerTool(
    "create_product",
    {
      description: "Create a simple WooCommerce product.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(200),
        regular_price: priceSchema,
        description: z.string().trim().max(5_000).optional(),
        status: productStatusSchema.default("draft"),
      }),
    },
    async ({ name, regular_price, description, status }) => {
      try {
        const product = await client.createProduct({ name, type: "simple", regular_price, description, status });
        return textResult({ product: productSummary(product) });
      } catch (error) {
        logWooCommerceFailure("create_product", error);
        return textResult({ error: sanitizedToolError(error) }, true);
      }
    },
  );

  server.registerTool(
    "list_orders",
    {
      description: "List WooCommerce orders without customer or payment details.",
      inputSchema: z.object({
        page: pageSchema,
        per_page: perPageSchema,
        status: orderStatusSchema.optional(),
      }),
    },
    async ({ page, per_page, status }) => {
      try {
        const orders = await client.listOrders({ page, per_page, status });
        return textResult({ orders: orders.map(orderSummary) });
      } catch (error) {
        logWooCommerceFailure("list_orders", error);
        return textResult({ error: sanitizedToolError(error) }, true);
      }
    },
  );

  server.registerTool(
    "get_order",
    {
      description: "Get an order by ID without customer or payment details.",
      inputSchema: z.object({ order_id: idSchema }),
    },
    async ({ order_id }) => {
      try {
        return textResult({ order: orderSummary(await client.getOrder(order_id)) });
      } catch (error) {
        logWooCommerceFailure("get_order", error);
        return textResult({ error: sanitizedToolError(error) }, true);
      }
    },
  );

  server.registerTool(
    "update_order_status",
    {
      description: "Update a WooCommerce order's status.",
      inputSchema: z.object({ order_id: idSchema, status: orderStatusSchema }),
    },
    async ({ order_id, status }) => {
      try {
        return textResult({ order: orderSummary(await client.updateOrderStatus(order_id, status)) });
      } catch (error) {
        logWooCommerceFailure("update_order_status", error);
        return textResult({ error: sanitizedToolError(error) }, true);
      }
    },
  );

  return server;
}

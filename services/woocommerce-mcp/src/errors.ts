export class WooCommerceClientError extends Error {
  public constructor(
    public readonly kind: "http" | "network" | "timeout" | "response",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "WooCommerceClientError";
  }
}

export function sanitizedToolError(error: unknown): string {
  if (error instanceof WooCommerceClientError) {
    return error.message;
  }

  return "The WooCommerce service could not complete this request.";
}

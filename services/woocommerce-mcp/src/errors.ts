export class WooCommerceClientError extends Error {
  public constructor(
    public readonly kind: "http" | "network" | "timeout" | "response",
    message: string,
    public readonly status?: number,
    public readonly wooCommerceCode?: string,
  ) {
    super(message);
    this.name = "WooCommerceClientError";
  }
}

export function safeWooCommerceDiagnostic(operation: string, error: unknown): string {
  if (error instanceof WooCommerceClientError) {
    const details = [
      `kind=${error.kind}`,
      error.status === undefined ? undefined : `status=${error.status}`,
      error.wooCommerceCode === undefined ? undefined : `woocommerce_code=${error.wooCommerceCode}`,
    ].filter((detail): detail is string => detail !== undefined);

    return `WooCommerce ${operation} failed (${details.join(", ")}).`;
  }

  return `WooCommerce ${operation} failed (kind=unknown).`;
}

export function logWooCommerceFailure(operation: string, error: unknown): void {
  console.error(safeWooCommerceDiagnostic(operation, error));
}

export function sanitizedToolError(error: unknown): string {
  if (error instanceof WooCommerceClientError) {
    return error.message;
  }

  return "The WooCommerce service could not complete this request.";
}

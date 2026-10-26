import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";

describe("dashboard routes", () => {
  for (const path of ["/", "/servers", "/team", "/audit", "/chat"]) {
    it(`matches ${path}`, () => {
      const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
      expect(router.matchRoutes(path).at(-1)?.pathname).toBe(path);
    });
  }
});

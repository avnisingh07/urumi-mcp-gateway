import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import "./styles.css";
import { getRouter } from "./router";

const root = document.getElementById("root");
if (!root) throw new Error("Dashboard root element is missing.");
createRoot(root).render(<StrictMode><RouterProvider router={getRouter()} /></StrictMode>);

import { createRoot } from "react-dom/client";
import { WebApp } from "./WebApp";
import "../index.css";
import "../mobile/mobile.css";
import "./web.css";

createRoot(document.getElementById("root")!).render(<WebApp />);

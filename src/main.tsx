import React from "react";
import ReactDOM from "react-dom/client";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import { PetContextMenu } from "./components/PetContextMenu";
import { PetWindow } from "./components/PetWindow";
import "./styles.css";

function currentWindowLabel() {
  const params = new URLSearchParams(window.location.search);
  const queryLabel = params.get("label") ?? params.get("window");
  if (queryLabel) return queryLabel;
  try {
    return WebviewWindow.getCurrent().label;
  } catch {
    return "";
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {currentWindowLabel() === "pet" ? (
      <PetWindow />
    ) : currentWindowLabel() === "pet-menu" ? (
      <PetContextMenu />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);

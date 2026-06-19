import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { WalletProvider } from "./context/WalletContext";
import { ToastProvider } from "./components/feedback/ToastProvider";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </WalletProvider>
    </BrowserRouter>
  </React.StrictMode>
);

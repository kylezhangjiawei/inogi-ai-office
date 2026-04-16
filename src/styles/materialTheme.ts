import { createTheme } from "@mui/material/styles";

export const materialTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1976d2",
      light: "#42a5f5",
      dark: "#0d47a1",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#546e7a",
    },
    background: {
      default: "#f3f6fb",
      paper: "#ffffff",
    },
    success: {
      main: "#2e7d32",
    },
    warning: {
      main: "#ed6c02",
    },
    error: {
      main: "#d32f2f",
    },
    text: {
      primary: "#1f2937",
      secondary: "#5f6b7a",
    },
    divider: "#d8e2ee",
  },
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: '"Roboto", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    h1: {
      fontSize: "2rem",
      fontWeight: 700,
    },
    h2: {
      fontSize: "1.5rem",
      fontWeight: 700,
    },
    h3: {
      fontSize: "1.125rem",
      fontWeight: 700,
    },
    button: {
      fontWeight: 600,
      textTransform: "none",
      letterSpacing: "0.01em",
    },
  },
  shadows: [
    "none",
    "0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.06)",
    "0 4px 10px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.05)",
    "0 10px 24px rgba(15, 23, 42, 0.08), 0 4px 8px rgba(15, 23, 42, 0.05)",
    "0 14px 32px rgba(15, 23, 42, 0.1), 0 6px 12px rgba(15, 23, 42, 0.06)",
    "0 18px 40px rgba(15, 23, 42, 0.11), 0 8px 16px rgba(15, 23, 42, 0.07)",
    "0 22px 48px rgba(15, 23, 42, 0.12), 0 10px 20px rgba(15, 23, 42, 0.07)",
    "0 26px 56px rgba(15, 23, 42, 0.13), 0 12px 24px rgba(15, 23, 42, 0.08)",
    "0 30px 64px rgba(15, 23, 42, 0.14), 0 14px 28px rgba(15, 23, 42, 0.08)",
    "0 34px 72px rgba(15, 23, 42, 0.15), 0 16px 32px rgba(15, 23, 42, 0.09)",
    "0 38px 80px rgba(15, 23, 42, 0.16), 0 18px 36px rgba(15, 23, 42, 0.09)",
    "0 42px 88px rgba(15, 23, 42, 0.17), 0 20px 40px rgba(15, 23, 42, 0.1)",
    "0 46px 96px rgba(15, 23, 42, 0.18), 0 22px 44px rgba(15, 23, 42, 0.1)",
    "0 50px 104px rgba(15, 23, 42, 0.19), 0 24px 48px rgba(15, 23, 42, 0.11)",
    "0 54px 112px rgba(15, 23, 42, 0.2), 0 26px 52px rgba(15, 23, 42, 0.11)",
    "0 58px 120px rgba(15, 23, 42, 0.2), 0 28px 56px rgba(15, 23, 42, 0.12)",
    "0 62px 128px rgba(15, 23, 42, 0.21), 0 30px 60px rgba(15, 23, 42, 0.12)",
    "0 66px 136px rgba(15, 23, 42, 0.22), 0 32px 64px rgba(15, 23, 42, 0.13)",
    "0 70px 144px rgba(15, 23, 42, 0.23), 0 34px 68px rgba(15, 23, 42, 0.13)",
    "0 74px 152px rgba(15, 23, 42, 0.24), 0 36px 72px rgba(15, 23, 42, 0.14)",
    "0 78px 160px rgba(15, 23, 42, 0.25), 0 38px 76px rgba(15, 23, 42, 0.14)",
    "0 82px 168px rgba(15, 23, 42, 0.25), 0 40px 80px rgba(15, 23, 42, 0.15)",
    "0 86px 176px rgba(15, 23, 42, 0.26), 0 42px 84px rgba(15, 23, 42, 0.15)",
    "0 90px 184px rgba(15, 23, 42, 0.27), 0 44px 88px rgba(15, 23, 42, 0.16)",
    "0 94px 192px rgba(15, 23, 42, 0.28), 0 46px 92px rgba(15, 23, 42, 0.16)",
  ],
});

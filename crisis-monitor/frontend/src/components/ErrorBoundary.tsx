import React from "react";

interface Props {
  children: React.ReactNode;
  fallback: (error: Error, retry: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

const RELOAD_KEY = "lens.staleBuildReloaded";
const isStaleBuildError = (error: Error) => /dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed/i.test(error?.message ?? "");

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
    // After a new version is deployed, a device with an older copy of the page asks for a script file that no longer
    // exists. Reloading fetches the new page. Only once per tab, so a real fault still shows its message.
    if (isStaleBuildError(error)) {
      try {
        if (!sessionStorage.getItem(RELOAD_KEY)) {
          sessionStorage.setItem(RELOAD_KEY, "1");
          location.reload();
        }
      } catch {
        /* storage blocked: show the message instead */
      }
    }
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.retry);
    }
    return this.props.children;
  }
}

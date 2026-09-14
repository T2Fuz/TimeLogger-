import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("App crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh", background: "#0a0a0a", color: "#f87171",
          padding: 20, fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap"
        }}>
          <div style={{ color: "#fff", fontWeight: "bold", marginBottom: 10 }}>
            App crashed — screenshot this and send it back:
          </div>
          {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

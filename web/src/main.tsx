import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/styles.css';

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[UI] render crash', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="fatal-screen">
        <div className="fatal-card">
          <span className="eyebrow">Ошибка интерфейса</span>
          <h1>Панель не смогла отрисоваться</h1>
          <p>
            Данные с сервера пришли в неожиданном формате. Перезагрузите страницу; если ошибка повторится,
            проверьте консоль и API-ответы.
          </p>
          <pre>{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

import { Playground } from './Playground';

export function App() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('playground')) {
        return <Playground />;
    }
    return (
        <div className="shell">
            <header className="topbar">
                <h1>SandwichTS</h1>
                <span className="tag">TaskBoard demo — coming in Phase 6</span>
            </header>
            <p style={{ padding: '2rem' }}>
                The chat-driven TaskBoard lands in Phase 6. Until then, the sandbox
                playground is at <a href="/?playground=1">/?playground=1</a>.
            </p>
        </div>
    );
}

import { Board } from './Board';
import { Chat } from './Chat';
import { Playground } from './Playground';

export function App() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('playground')) {
        return <Playground />;
    }
    const mode = params.has('mock') ? 'mock' : params.has('customEvent') ? 'custom-event' : 'live';
    return (
        <div className="shell taskboard">
            <header className="topbar">
                <h1>SandwichTS <span className="logo-sub">TaskBoard</span></h1>
                <span className="tag">code-mode demo · {mode}</span>
                <a className="tag" href="/?playground=1">sandbox playground →</a>
            </header>
            <main className="layout">
                <Board />
                <Chat />
            </main>
        </div>
    );
}

import { render } from 'preact';
import { App } from './app';
import { normaliseAddress } from './router';
import { startSelfUpdate } from './update';
import './ui/styles.css';

normaliseAddress();
render(<App />, document.getElementById('app')!);
startSelfUpdate();

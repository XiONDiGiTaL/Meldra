import './../style.css';
import { App } from './app.js';

const root = document.getElementById('app');
if (!root) throw new Error('Meldra root element is missing');
new App(root);

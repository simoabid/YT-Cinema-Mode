/**
 * Minimal DOM stand-in for the content-script test suite.
 *
 * It implements only what the overlay modules actually touch, but it implements
 * it faithfully enough to run real control code: classList, style, dataset,
 * attributes, the child tree, event listeners and a selector matcher for the
 * simple selector shapes used here (`.class`, `#id`, `tag`, comma lists).
 *
 * `innerHTML` is stored as a string rather than parsed. Tests that care about
 * rendered markup spy on the setter instead of reading a parsed tree.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'path', 'use', 'area']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, body) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X'
                ? parseInt(body.slice(2), 16)
                : parseInt(body.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : full;
        }
        return ENTITIES[body] !== undefined ? ENTITIES[body] : full;
    });
}

/**
 * Tiny HTML parser: enough for the markup these modules build (elements with
 * class attributes, nesting, void tags and text runs). It is not a spec-compliant
 * parser and does not need to be — it exists so tests can assert on rendered
 * menus and toasts the same way the browser would.
 */
function parseHTML(html, doc) {
    const fragment = doc.createElement('#fragment');
    const stack = [fragment];
    const token = /<\/?([a-zA-Z0-9-]+)((?:\s+[a-zA-Z0-9:_-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;

    let match;
    while ((match = token.exec(html)) !== null) {
        const [, rawTag, attrString, selfClose, textRun] = match;

        if (textRun !== undefined) {
            if (textRun.trim()) {
                stack[stack.length - 1].appendChild(doc.createTextNode(decodeEntities(textRun)));
            }
            continue;
        }

        const tag = rawTag.toLowerCase();

        if (match[0].startsWith('</')) {
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].tagName.toLowerCase() === tag) { stack.length = i; break; }
            }
            continue;
        }

        const el = doc.createElement(tag);
        const attr = /([a-zA-Z0-9:_-]+)\s*=\s*"([^"]*)"/g;
        let a;
        while ((a = attr.exec(attrString || '')) !== null) {
            el.setAttribute(a[1], decodeEntities(a[2]));
        }
        stack[stack.length - 1].appendChild(el);

        if (selfClose !== '/' && !VOID_TAGS.has(tag)) stack.push(el);
    }

    return fragment;
}

/**
 * Parse one compound selector: `tag`, `.class`, `#id`, `[attr*="value"]`,
 * `:not(...)`, `*`. Enough for every selector the extension uses.
 */
function parseCompound(raw) {
    const compound = { tag: null, classes: [], id: null, not: [], attrs: [] };
    let i = 0;

    while (i < raw.length) {
        const ch = raw[i];

        if (ch === '*') { i++; continue; }

        if (ch === '.') {
            let j = i + 1;
            while (j < raw.length && /[\w-]/.test(raw[j])) j++;
            compound.classes.push(raw.slice(i + 1, j));
            i = j;
            continue;
        }

        if (ch === '#') {
            let j = i + 1;
            while (j < raw.length && /[\w-]/.test(raw[j])) j++;
            compound.id = raw.slice(i + 1, j);
            i = j;
            continue;
        }

        if (raw.startsWith(':not(', i)) {
            const end = raw.indexOf(')', i);
            compound.not.push(raw.slice(i + 5, end).trim());
            i = end + 1;
            continue;
        }

        if (ch === '[') {
            const end = raw.indexOf(']', i);
            const body = raw.slice(i + 1, end);
            const match = /^([\w:-]+)\s*(?:([~^$*|]?=)\s*"([^"]*)")?$/.exec(body.trim());
            if (match) compound.attrs.push({ name: match[1], op: match[2], value: match[3] });
            i = end + 1;
            continue;
        }

        let j = i;
        while (j < raw.length && /[\w-]/.test(raw[j])) j++;
        if (j > i) {
            compound.tag = raw.slice(i, j).toLowerCase();
            i = j;
        } else {
            i++; // unsupported token; skip so we never loop forever
        }
    }

    return compound;
}

function matchesAttr(el, { name, op, value }) {
    const actual = el.getAttribute(name);
    if (actual === null) return false;
    if (!op) return true;
    if (op === '=') return actual === value;
    if (op === '*=') return actual.includes(value);
    if (op === '^=') return actual.startsWith(value);
    if (op === '$=') return actual.endsWith(value);
    return false;
}

function matchesCompound(el, compound) {
    if (!el || !el.tagName) return false;
    if (compound.tag && el.tagName.toLowerCase() !== compound.tag) return false;
    if (compound.id !== null && el.getAttribute('id') !== compound.id) return false;
    for (const cls of compound.classes) if (!el.classList.contains(cls)) return false;
    for (const attr of compound.attrs) if (!matchesAttr(el, attr)) return false;
    for (const neg of compound.not) if (matchesCompound(el, parseCompound(neg))) return false;
    return true;
}

/** Split a selector list on commas that are not inside `[]`, `()` or quotes. */
function splitSelectorList(selector) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let start = 0;

    for (let i = 0; i < selector.length; i++) {
        const ch = selector[i];
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '[' || ch === '(') { depth++; continue; }
        if (ch === ']' || ch === ')') { depth--; continue; }
        if (ch === ',' && depth === 0) {
            parts.push(selector.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(selector.slice(start));
    return parts.map((p) => p.trim()).filter(Boolean);
}

/** Split one selector on descendant whitespace, respecting brackets and quotes. */
function splitDescendants(part) {
    const compounds = [];
    let depth = 0;
    let quote = null;
    let start = 0;

    const push = (end) => {
        const text = part.slice(start, end).trim();
        if (text) compounds.push(text);
    };

    for (let i = 0; i < part.length; i++) {
        const ch = part[i];
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '[' || ch === '(') { depth++; continue; }
        if (ch === ']' || ch === ')') { depth--; continue; }
        if (/\s/.test(ch) && depth === 0) {
            push(i);
            start = i + 1;
        }
    }
    push(part.length);
    return compounds;
}

/** Does `el` match one complex selector part (`a b > c`-style descendants)? */
function matchesComplex(el, part) {
    const compounds = splitDescendants(part).map(parseCompound);
    if (compounds.length === 0) return false;
    if (!matchesCompound(el, compounds[compounds.length - 1])) return false;

    let node = el.parentNode;
    let idx = compounds.length - 2;
    while (idx >= 0 && node) {
        if (matchesCompound(node, compounds[idx])) idx--;
        node = node.parentNode;
    }
    return idx < 0;
}

function matchesSelector(el, selector) {
    return splitSelectorList(selector).some((part) => matchesComplex(el, part));
}

class ClassList {
    constructor(owner) {
        this.owner = owner;
        this.tokens = new Set();
    }
    add(...names) { names.forEach((n) => this.tokens.add(n)); }
    remove(...names) { names.forEach((n) => this.tokens.delete(n)); }
    contains(name) { return this.tokens.has(name); }
    toggle(name, force) {
        const on = force === undefined ? !this.tokens.has(name) : Boolean(force);
        if (on) this.tokens.add(name); else this.tokens.delete(name);
        return on;
    }
    get value() { return Array.from(this.tokens).join(' '); }
    set value(raw) {
        this.tokens = new Set(String(raw).split(/\s+/).filter(Boolean));
    }
}

class Style {
    constructor() {
        this._props = new Map();
        // Proxy so `style.display = 'none'` and `style.width` behave like the
        // real CSSStyleDeclaration, where they are just property accessors.
        return new Proxy(this, {
            get(target, prop) {
                if (prop in target || typeof prop === 'symbol') return Reflect.get(target, prop);
                return target.getPropertyValue(prop);
            },
            set(target, prop, value) {
                if (prop in target || typeof prop === 'symbol') return Reflect.set(target, prop, value);
                target.setProperty(prop, value);
                return true;
            }
        });
    }
    setProperty(name, value) { this._props.set(name, value); }
    removeProperty(name) { this._props.delete(name); }
    getPropertyValue(name) { return this._props.get(name) ?? ''; }
    get cssText() { return Array.from(this._props, ([k, v]) => `${k}:${v}`).join(';'); }
}

class EventTarget_ {
    constructor() { this._listeners = new Map(); }
    addEventListener(type, fn, opts) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push({ fn, capture: Boolean(opts === true || (opts && opts.capture)) });
    }
    removeEventListener(type, fn, opts) {
        const list = this._listeners.get(type);
        if (!list) return;
        const capture = Boolean(opts === true || (opts && opts.capture));
        const idx = list.findIndex((l) => l.fn === fn && l.capture === capture);
        if (idx >= 0) list.splice(idx, 1);
    }
    listenerCount(type) { return (this._listeners.get(type) || []).length; }
    dispatchEvent(event) {
        const list = this._listeners.get(event.type) || [];
        // Snapshot: handlers may add or remove listeners while we iterate.
        for (const { fn } of [...list]) fn.call(this, event);
        return true;
    }
}

class Element extends EventTarget_ {
    constructor(tagName, ownerDoc) {
        super();
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDoc;
        this.classList = new ClassList(this);
        this.style = new Style();
        this.dataset = {};
        this.childNodes = [];
        this.parentNode = null;
        this.attributes = new Map();
        this._innerHTML = '';
        this._textContent = '';
        this.offsetWidth = 0;
        this.offsetHeight = 0;
        this.videoWidth = 0;
        this.videoHeight = 0;

        if (tagName === 'a') {
            Object.defineProperty(this, 'href', {
                get() { return this.getAttribute('href') || ''; },
                set(value) { this.setAttribute('href', value); }
            });
        }
    }

    get children() { return this.childNodes.filter((n) => n instanceof Element); }
    get firstChild() { return this.childNodes[0] || null; }

    get className() { return this.classList.value; }
    set className(value) { this.classList.value = value; }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(value) {
        this._innerHTML = String(value);
        this.childNodes = [];
        for (const child of parseHTML(this._innerHTML, this.ownerDocument || this).childNodes) {
            this.appendChild(child);
        }
    }

    get textContent() {
        if (this.childNodes.length === 0) return this._textContent;
        return this.childNodes.map((n) => n.textContent || '').join('');
    }
    set textContent(value) { this._textContent = String(value); this.childNodes = []; }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === 'class') this.classList.value = value;
        else if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            this.dataset[key] = String(value);
        }
    }
    getAttribute(name) {
        if (name === 'class') return this.classList.value || null;
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    removeAttribute(name) {
        this.attributes.delete(name);
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            delete this.dataset[key];
        }
    }
    hasAttribute(name) { return this.attributes.has(name); }

    /** Reflects to the attribute, the way the real DOM does. */
    get id() { return this.attributes.has('id') ? this.attributes.get('id') : ''; }
    set id(value) { this.attributes.set('id', String(value)); }

    appendChild(child) {
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }
    insertBefore(child, ref) {
        child.parentNode = this;
        const idx = ref ? this.childNodes.indexOf(ref) : -1;
        if (idx < 0) this.childNodes.push(child); else this.childNodes.splice(idx, 0, child);
        return child;
    }
    removeChild(child) {
        const idx = this.childNodes.indexOf(child);
        if (idx >= 0) this.childNodes.splice(idx, 1);
        child.parentNode = null;
        return child;
    }
    remove() { this.parentNode?.removeChild(this); }

    contains(node) {
        if (node === this) return true;
        return this.childNodes.some((c) => (c instanceof Element ? c.contains(node) : false));
    }

    closest(selector) {
        let node = this;
        while (node) {
            if (matchesSelector(node, selector)) return node;
            node = node.parentNode;
        }
        return null;
    }

    _walk(out) {
        for (const child of this.childNodes) {
            if (!(child instanceof Element)) continue;
            out.push(child);
            child._walk(out);
        }
        return out;
    }

    querySelector(selector) { return this._walk([]).find((el) => matchesSelector(el, selector)) || null; }
    querySelectorAll(selector) { return this._walk([]).filter((el) => matchesSelector(el, selector)); }

    getBoundingClientRect() {
        return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    }
    getContext(kind) {
        if (kind !== '2d') return null;
        if (!this._ctx2d) {
            this._ctx2d = {
                imageSmoothingQuality: 'low',
                fillStyle: '',
                drawImage() {},
                getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
                putImageData() {},
                clearRect() {}
            };
        }
        return this._ctx2d;
    }
    toBlob(cb) { cb({ size: 0, type: 'image/png' }); }
    focus() {}
    blur() {}
    scrollIntoView() {}
    click() { this.dispatchEvent(makeEvent('click')); }
    get isConnected() {
        if (this._connectedTo) return true;
        let node = this;
        while (node.parentNode) node = node.parentNode;
        // The document is the root; anything still attached to it is connected.
        return node === this.ownerDocument;
    }
}

class Document extends Element {
    constructor() {
        super('#document', null);
        this.ownerDocument = this;
        this.documentElement = new Element('html', this);
        this.documentElement.parentNode = this;
        this.head = new Element('head', this);
        this.body = new Element('body', this);
        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);
        this.childNodes = [this.documentElement];
    }
    createElement(tag) { return new Element(tag, this); }
    createElementNS(_ns, tag) { return new Element(tag, this); }
    createTextNode(text) { const n = new Element('#text', this); n._textContent = text; return n; }
    createEvent() { return makeEvent(''); }
    execCommand() { return true; }
    getElementById(id) {
        return this._walk([]).find((el) => el.getAttribute('id') === id) || null;
    }
}

function makeEvent(type, props = {}) {
    return {
        type,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {},
        stopImmediatePropagation() {},
        ...props
    };
}

/** A fresh document plus the globals the content modules expect. */
function createDomEnv() {
    const document = new Document();
    document.body._connectedTo = true;
    document.documentElement._connectedTo = true;

    const window = new EventTarget_();
    window.document = document;
    window.innerWidth = 1920;
    window.innerHeight = 1080;
    window.location = { href: 'https://www.youtube.com/', pathname: '/', search: '' };
    window.open = () => null;
    window.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    window.getComputedStyle = () => ({ getPropertyValue: () => '' });
    window.pictureInPictureEnabled = false;

    document.pictureInPictureEnabled = false;
    document.pictureInPictureElement = null;
    document.exitPictureInPicture = () => { document.pictureInPictureElement = null; return Promise.resolve(); };

    return { window, document };
}

module.exports = { createDomEnv, makeEvent, parseHTML, Element, Document, SVG_NS };

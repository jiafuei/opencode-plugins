#!/usr/bin/env bun
// @bun
var en = Object.create;
var { getPrototypeOf: tn, defineProperty: Iu, getOwnPropertyNames: un } = Object;
var ks = Object.prototype.hasOwnProperty;
function sn(e) {
  return this[e];
}
var rn, nn, Be = (e, t, u) => {
  var s = e != null && typeof e === "object";
  if (s) {
    var i = t ? rn ??= /* @__PURE__ */ new WeakMap : nn ??= /* @__PURE__ */ new WeakMap, n = i.get(e);
    if (n)
      return n;
  }
  u = e != null ? en(tn(e)) : {};
  let a = t || !e || !e.__esModule || !ks.call(e, "default") ? Iu(u, "default", { value: e, enumerable: !0 }) : u;
  if (e && typeof e === "object" || typeof e === "function") {
    for (let d of un(e))
      if (!ks.call(a, d))
        Iu(a, d, {
          get: sn.bind(e, d),
          enumerable: !0
        });
  }
  if (s)
    i.set(e, a);
  return a;
};
var an = (e, t) => () => (t || e((t = { exports: {} }).exports, t), t.exports);
var cn = (e) => e;
function An(e, t) {
  this[e] = cn.bind(null, t);
}
var me = (e, t) => {
  for (var u in t)
    Iu(e, u, {
      get: t[u],
      enumerable: !0,
      configurable: !0,
      set: An.bind(t, u)
    });
};

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/boolbase/index.js
var Ie = an(function(qd, Sr) {
  Sr.exports = {
    trueFunc: function() {
      return !0;
    },
    falseFunc: function() {
      return !1;
    }
  };
});

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/static.js
var Fu = {};
me(Fu, {
  contains: () => vt,
  extract: () => $n,
  html: () => Vn,
  merge: () => ir,
  parseHTML: () => jn,
  root: () => zn,
  text: () => Re,
  xml: () => qn
});

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/domutils/lib/esm/index.js
var pe = {};
me(pe, {
  DocumentPosition: () => V,
  append: () => Rn,
  appendChild: () => On,
  compareDocumentPosition: () => tr,
  existsOne: () => $s,
  filter: () => We,
  find: () => Ht,
  findAll: () => Mn,
  findOne: () => Ut,
  findOneChild: () => Fn,
  getAttributeValue: () => Sn,
  getChildren: () => Ke,
  getElementById: () => Hn,
  getElements: () => Pn,
  getElementsByClassName: () => Un,
  getElementsByTagName: () => Oe,
  getElementsByTagType: () => Qn,
  getFeed: () => vn,
  getInnerHTML: () => Nn,
  getName: () => Bn,
  getOuterHTML: () => js,
  getParent: () => zs,
  getSiblings: () => Lu,
  getText: () => wt,
  hasAttrib: () => Dn,
  hasChildren: () => O,
  innerText: () => st,
  isCDATA: () => ve,
  isComment: () => xe,
  isDocument: () => ne,
  isTag: () => p,
  isText: () => W,
  nextElementSibling: () => kt,
  prepend: () => yn,
  prependChild: () => Ln,
  prevElementSibling: () => Pt,
  removeElement: () => oe,
  removeSubsets: () => Yn,
  replaceElement: () => xn,
  testElement: () => kn,
  textContent: () => Ae,
  uniqueSort: () => ge
});

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/attributes.js
var Wu = {};
me(Wu, {
  addClass: () => br,
  attr: () => oa,
  data: () => fa,
  hasClass: () => Ta,
  prop: () => da,
  removeAttr: () => ma,
  removeClass: () => pr,
  toggleClass: () => Ir,
  val: () => Ea
});

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/traversing.js
var fs = {};
me(fs, {
  _findBySelector: () => va,
  add: () => mc,
  addBack: () => Tc,
  children: () => ec,
  closest: () => Ja,
  contents: () => tc,
  each: () => uc,
  end: () => Ec,
  eq: () => oc,
  filter: () => rc,
  filterArray: () => hs,
  find: () => Ya,
  first: () => cc,
  get: () => dc,
  has: () => ac,
  index: () => hc,
  is: () => ic,
  last: () => Ac,
  map: () => sc,
  next: () => Za,
  nextAll: () => Xa,
  nextUntil: () => Va,
  not: () => nc,
  parent: () => Ga,
  parents: () => Ka,
  parentsUntil: () => Wa,
  prev: () => qa,
  prevAll: () => ja,
  prevUntil: () => za,
  siblings: () => $a,
  slice: () => fc,
  toArray: () => lc
});

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/manipulation.js
var Es = {};
me(Es, {
  _makeDomArray: () => gc,
  after: () => Bc,
  append: () => Ic,
  appendTo: () => bc,
  before: () => Oc,
  clone: () => Pc,
  empty: () => Fc,
  html: () => Mc,
  insertAfter: () => xc,
  insertBefore: () => Rc,
  prepend: () => Cc,
  prependTo: () => pc,
  remove: () => Lc,
  replaceWith: () => yc,
  text: () => kc,
  toString: () => wc,
  unwrap: () => Sc,
  wrap: () => _c,
  wrapAll: () => Dc,
  wrapInner: () => Nc
});

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/css.js
var ms = {};
me(ms, {
  css: () => Hc
});

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/forms.js
var Ts = {};
me(Ts, {
  serialize: () => vc,
  serializeArray: () => Gc
});

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/extract.js
var gs = {};
me(gs, {
  extract: () => Wc
});

// prune.ts
import { parseArgs as I0 } from "util";

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/options.js
var on = {
  _useHtmlParser2: !1
};
function tt(e, t) {
  if (!e)
    return t !== null && t !== void 0 ? t : on;
  let u = {
    _useHtmlParser2: !!e.xmlMode,
    ...t,
    ...e
  };
  if (e.xml) {
    if (u._useHtmlParser2 = !0, u.xmlMode = !0, e.xml !== !0)
      Object.assign(u, e.xml);
  } else if (e.xmlMode)
    u._useHtmlParser2 = !0;
  return u;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/domelementtype/lib/esm/index.js
var x;
(function(e) {
  e.Root = "root", e.Text = "text", e.Directive = "directive", e.Comment = "comment", e.Script = "script", e.Style = "style", e.Tag = "tag", e.CDATA = "cdata", e.Doctype = "doctype";
})(x || (x = {}));
function Ps(e) {
  return e.type === x.Tag || e.type === x.Script || e.type === x.Style;
}
var Bt = x.Root, Cu = x.Text, Hs = x.Directive, _u = x.Comment, Us = x.Script, Qs = x.Style, xt = x.Tag, Ys = x.CDATA, vs = x.Doctype;

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/domhandler/lib/esm/node.js
class Su {
  constructor() {
    this.parent = null, this.prev = null, this.next = null, this.startIndex = null, this.endIndex = null;
  }
  get parentNode() {
    return this.parent;
  }
  set parentNode(e) {
    this.parent = e;
  }
  get previousSibling() {
    return this.prev;
  }
  set previousSibling(e) {
    this.prev = e;
  }
  get nextSibling() {
    return this.next;
  }
  set nextSibling(e) {
    this.next = e;
  }
  cloneNode(e = !1) {
    return Ge(this, e);
  }
}

class Ot extends Su {
  constructor(e) {
    super();
    this.data = e;
  }
  get nodeValue() {
    return this.data;
  }
  set nodeValue(e) {
    this.data = e;
  }
}

class ce extends Ot {
  constructor() {
    super(...arguments);
    this.type = x.Text;
  }
  get nodeType() {
    return 3;
  }
}

class Qe extends Ot {
  constructor() {
    super(...arguments);
    this.type = x.Comment;
  }
  get nodeType() {
    return 8;
  }
}

class Ye extends Ot {
  constructor(e, t) {
    super(t);
    this.name = e, this.type = x.Directive;
  }
  get nodeType() {
    return 1;
  }
}

class Rt extends Su {
  constructor(e) {
    super();
    this.children = e;
  }
  get firstChild() {
    var e;
    return (e = this.children[0]) !== null && e !== void 0 ? e : null;
  }
  get lastChild() {
    return this.children.length > 0 ? this.children[this.children.length - 1] : null;
  }
  get childNodes() {
    return this.children;
  }
  set childNodes(e) {
    this.children = e;
  }
}

class Lt extends Rt {
  constructor() {
    super(...arguments);
    this.type = x.CDATA;
  }
  get nodeType() {
    return 4;
  }
}

class X extends Rt {
  constructor() {
    super(...arguments);
    this.type = x.Root;
  }
  get nodeType() {
    return 9;
  }
}

class Te extends Rt {
  constructor(e, t, u = [], s = e === "script" ? x.Script : e === "style" ? x.Style : x.Tag) {
    super(u);
    this.name = e, this.attribs = t, this.type = s;
  }
  get nodeType() {
    return 1;
  }
  get tagName() {
    return this.name;
  }
  set tagName(e) {
    this.name = e;
  }
  get attributes() {
    return Object.keys(this.attribs).map((e) => {
      var t, u;
      return {
        name: e,
        value: this.attribs[e],
        namespace: (t = this["x-attribsNamespace"]) === null || t === void 0 ? void 0 : t[e],
        prefix: (u = this["x-attribsPrefix"]) === null || u === void 0 ? void 0 : u[e]
      };
    });
  }
}
function p(e) {
  return Ps(e);
}
function ve(e) {
  return e.type === x.CDATA;
}
function W(e) {
  return e.type === x.Text;
}
function xe(e) {
  return e.type === x.Comment;
}
function yt(e) {
  return e.type === x.Directive;
}
function ne(e) {
  return e.type === x.Root;
}
function O(e) {
  return Object.prototype.hasOwnProperty.call(e, "children");
}
function Ge(e, t = !1) {
  let u;
  if (W(e))
    u = new ce(e.data);
  else if (xe(e))
    u = new Qe(e.data);
  else if (p(e)) {
    let s = t ? Nu(e.children) : [], i = new Te(e.name, { ...e.attribs }, s);
    if (s.forEach((n) => n.parent = i), e.namespace != null)
      i.namespace = e.namespace;
    if (e["x-attribsNamespace"])
      i["x-attribsNamespace"] = { ...e["x-attribsNamespace"] };
    if (e["x-attribsPrefix"])
      i["x-attribsPrefix"] = { ...e["x-attribsPrefix"] };
    u = i;
  } else if (ve(e)) {
    let s = t ? Nu(e.children) : [], i = new Lt(s);
    s.forEach((n) => n.parent = i), u = i;
  } else if (ne(e)) {
    let s = t ? Nu(e.children) : [], i = new X(s);
    if (s.forEach((n) => n.parent = i), e["x-mode"])
      i["x-mode"] = e["x-mode"];
    u = i;
  } else if (yt(e)) {
    let s = new Ye(e.name, e.data);
    if (e["x-name"] != null)
      s["x-name"] = e["x-name"], s["x-publicId"] = e["x-publicId"], s["x-systemId"] = e["x-systemId"];
    u = s;
  } else
    throw Error(`Not implemented yet: ${e.type}`);
  if (u.startIndex = e.startIndex, u.endIndex = e.endIndex, e.sourceCodeLocation != null)
    u.sourceCodeLocation = e.sourceCodeLocation;
  return u;
}
function Nu(e) {
  let t = e.map((u) => Ge(u, !0));
  for (let u = 1;u < t.length; u++)
    t[u].prev = t[u - 1], t[u - 1].next = t[u];
  return t;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/domhandler/lib/esm/index.js
var Gs = {
  withStartIndices: !1,
  withEndIndices: !1,
  xmlMode: !1
};

class Du {
  constructor(e, t, u) {
    if (this.dom = [], this.root = new X(this.dom), this.done = !1, this.tagStack = [this.root], this.lastNode = null, this.parser = null, typeof t === "function")
      u = t, t = Gs;
    if (typeof e === "object")
      t = e, e = void 0;
    this.callback = e !== null && e !== void 0 ? e : null, this.options = t !== null && t !== void 0 ? t : Gs, this.elementCB = u !== null && u !== void 0 ? u : null;
  }
  onparserinit(e) {
    this.parser = e;
  }
  onreset() {
    this.dom = [], this.root = new X(this.dom), this.done = !1, this.tagStack = [this.root], this.lastNode = null, this.parser = null;
  }
  onend() {
    if (this.done)
      return;
    this.done = !0, this.parser = null, this.handleCallback(null);
  }
  onerror(e) {
    this.handleCallback(e);
  }
  onclosetag() {
    this.lastNode = null;
    let e = this.tagStack.pop();
    if (this.options.withEndIndices)
      e.endIndex = this.parser.endIndex;
    if (this.elementCB)
      this.elementCB(e);
  }
  onopentag(e, t) {
    let u = this.options.xmlMode ? x.Tag : void 0, s = new Te(e, t, void 0, u);
    this.addNode(s), this.tagStack.push(s);
  }
  ontext(e) {
    let { lastNode: t } = this;
    if (t && t.type === x.Text) {
      if (t.data += e, this.options.withEndIndices)
        t.endIndex = this.parser.endIndex;
    } else {
      let u = new ce(e);
      this.addNode(u), this.lastNode = u;
    }
  }
  oncomment(e) {
    if (this.lastNode && this.lastNode.type === x.Comment) {
      this.lastNode.data += e;
      return;
    }
    let t = new Qe(e);
    this.addNode(t), this.lastNode = t;
  }
  oncommentend() {
    this.lastNode = null;
  }
  oncdatastart() {
    let e = new ce(""), t = new Lt([e]);
    this.addNode(t), e.parent = t, this.lastNode = e;
  }
  oncdataend() {
    this.lastNode = null;
  }
  onprocessinginstruction(e, t) {
    let u = new Ye(e, t);
    this.addNode(u);
  }
  handleCallback(e) {
    if (typeof this.callback === "function")
      this.callback(e, this.dom);
    else if (e)
      throw e;
  }
  addNode(e) {
    let t = this.tagStack[this.tagStack.length - 1], u = t.children[t.children.length - 1];
    if (this.options.withStartIndices)
      e.startIndex = this.parser.startIndex;
    if (this.options.withEndIndices)
      e.endIndex = this.parser.endIndex;
    if (t.children.push(e), u)
      e.prev = u, u.next = e;
    e.parent = t, this.lastNode = null;
  }
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/entities/lib/esm/escape.js
var Ks = /["&'<>$\x80-\uFFFF]/g, Ws = /* @__PURE__ */ new Map([
  [34, "&quot;"],
  [38, "&amp;"],
  [39, "&apos;"],
  [60, "&lt;"],
  [62, "&gt;"]
]), dn = String.prototype.codePointAt != null ? (e, t) => e.codePointAt(t) : (e, t) => (e.charCodeAt(t) & 64512) === 55296 ? (e.charCodeAt(t) - 55296) * 1024 + e.charCodeAt(t + 1) - 56320 + 65536 : e.charCodeAt(t);
function Ft(e) {
  let t = "", u = 0, s;
  while ((s = Ks.exec(e)) !== null) {
    let i = s.index, n = e.charCodeAt(i), a = Ws.get(n);
    if (a !== void 0)
      t += e.substring(u, i) + a, u = i + 1;
    else
      t += `${e.substring(u, i)}&#x${dn(e, i).toString(16)};`, u = Ks.lastIndex += Number((n & 64512) === 55296);
  }
  return t + e.substr(u);
}
function Bu(e, t) {
  return function(s) {
    let i, n = 0, a = "";
    while (i = e.exec(s)) {
      if (n !== i.index)
        a += s.substring(n, i.index);
      a += t.get(i[0].charCodeAt(0)), n = i.index + 1;
    }
    return a + s.substring(n);
  };
}
var ln = Bu(/[&<>'"]/g, Ws), xu = Bu(/["&\u00A0]/g, /* @__PURE__ */ new Map([
  [34, "&quot;"],
  [38, "&amp;"],
  [160, "&nbsp;"]
])), Ou = Bu(/[&<>\u00A0]/g, /* @__PURE__ */ new Map([
  [38, "&amp;"],
  [60, "&lt;"],
  [62, "&gt;"],
  [160, "&nbsp;"]
]));
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/entities/lib/esm/index.js
var Js;
(function(e) {
  e[e.XML = 0] = "XML", e[e.HTML = 1] = "HTML";
})(Js || (Js = {}));
var Zs;
(function(e) {
  e[e.UTF8 = 0] = "UTF8", e[e.ASCII = 1] = "ASCII", e[e.Extensive = 2] = "Extensive", e[e.Attribute = 3] = "Attribute", e[e.Text = 4] = "Text";
})(Zs || (Zs = {}));

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/dom-serializer/lib/esm/foreignNames.js
var Xs = new Map([
  "altGlyph",
  "altGlyphDef",
  "altGlyphItem",
  "animateColor",
  "animateMotion",
  "animateTransform",
  "clipPath",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "foreignObject",
  "glyphRef",
  "linearGradient",
  "radialGradient",
  "textPath"
].map((e) => [e.toLowerCase(), e])), Vs = new Map([
  "definitionURL",
  "attributeName",
  "attributeType",
  "baseFrequency",
  "baseProfile",
  "calcMode",
  "clipPathUnits",
  "diffuseConstant",
  "edgeMode",
  "filterUnits",
  "glyphRef",
  "gradientTransform",
  "gradientUnits",
  "kernelMatrix",
  "kernelUnitLength",
  "keyPoints",
  "keySplines",
  "keyTimes",
  "lengthAdjust",
  "limitingConeAngle",
  "markerHeight",
  "markerUnits",
  "markerWidth",
  "maskContentUnits",
  "maskUnits",
  "numOctaves",
  "pathLength",
  "patternContentUnits",
  "patternTransform",
  "patternUnits",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "preserveAlpha",
  "preserveAspectRatio",
  "primitiveUnits",
  "refX",
  "refY",
  "repeatCount",
  "repeatDur",
  "requiredExtensions",
  "requiredFeatures",
  "specularConstant",
  "specularExponent",
  "spreadMethod",
  "startOffset",
  "stdDeviation",
  "stitchTiles",
  "surfaceScale",
  "systemLanguage",
  "tableValues",
  "targetX",
  "targetY",
  "textLength",
  "viewBox",
  "viewTarget",
  "xChannelSelector",
  "yChannelSelector",
  "zoomAndPan"
].map((e) => [e.toLowerCase(), e]));

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/dom-serializer/lib/esm/index.js
var hn = /* @__PURE__ */ new Set([
  "style",
  "script",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "noscript"
]);
function fn(e) {
  return e.replace(/"/g, "&quot;");
}
function En(e, t) {
  var u;
  if (!e)
    return;
  let s = ((u = t.encodeEntities) !== null && u !== void 0 ? u : t.decodeEntities) === !1 ? fn : t.xmlMode || t.encodeEntities !== "utf8" ? Ft : xu;
  return Object.keys(e).map((i) => {
    var n, a;
    let d = (n = e[i]) !== null && n !== void 0 ? n : "";
    if (t.xmlMode === "foreign")
      i = (a = Vs.get(i)) !== null && a !== void 0 ? a : i;
    if (!t.emptyAttrs && !t.xmlMode && d === "")
      return i;
    return `${i}="${s(d)}"`;
  }).join(" ");
}
var qs = /* @__PURE__ */ new Set([
  "area",
  "base",
  "basefont",
  "br",
  "col",
  "command",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "isindex",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);
function Ru(e, t = {}) {
  let u = "length" in e ? e : [e], s = "";
  for (let i = 0;i < u.length; i++)
    s += mn(u[i], t);
  return s;
}
var Mt = Ru;
function mn(e, t) {
  switch (e.type) {
    case Bt:
      return Ru(e.children, t);
    case vs:
    case Hs:
      return pn(e);
    case _u:
      return _n(e);
    case Ys:
      return Cn(e);
    case Us:
    case Qs:
    case xt:
      return bn(e, t);
    case Cu:
      return In(e, t);
  }
}
var Tn = /* @__PURE__ */ new Set([
  "mi",
  "mo",
  "mn",
  "ms",
  "mtext",
  "annotation-xml",
  "foreignObject",
  "desc",
  "title"
]), gn = /* @__PURE__ */ new Set(["svg", "math"]);
function bn(e, t) {
  var u;
  if (t.xmlMode === "foreign") {
    if (e.name = (u = Xs.get(e.name)) !== null && u !== void 0 ? u : e.name, e.parent && Tn.has(e.parent.name))
      t = { ...t, xmlMode: !1 };
  }
  if (!t.xmlMode && gn.has(e.name))
    t = { ...t, xmlMode: "foreign" };
  let s = `<${e.name}`, i = En(e.attribs, t);
  if (i)
    s += ` ${i}`;
  if (e.children.length === 0 && (t.xmlMode ? t.selfClosingTags !== !1 : t.selfClosingTags && qs.has(e.name))) {
    if (!t.xmlMode)
      s += " ";
    s += "/>";
  } else {
    if (s += ">", e.children.length > 0)
      s += Ru(e.children, t);
    if (t.xmlMode || !qs.has(e.name))
      s += `</${e.name}>`;
  }
  return s;
}
function pn(e) {
  return `<${e.data}>`;
}
function In(e, t) {
  var u;
  let s = e.data || "";
  if (((u = t.encodeEntities) !== null && u !== void 0 ? u : t.decodeEntities) !== !1 && !(!t.xmlMode && e.parent && hn.has(e.parent.name)))
    s = t.xmlMode || t.encodeEntities !== "utf8" ? Ft(s) : Ou(s);
  return s;
}
function Cn(e) {
  return `<![CDATA[${e.children[0].data}]]>`;
}
function _n(e) {
  return `<!--${e.data}-->`;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/domutils/lib/esm/stringify.js
function js(e, t) {
  return Mt(e, t);
}
function Nn(e, t) {
  return O(e) ? e.children.map((u) => js(u, t)).join("") : "";
}
function wt(e) {
  if (Array.isArray(e))
    return e.map(wt).join("");
  if (p(e))
    return e.name === "br" ? `
` : wt(e.children);
  if (ve(e))
    return wt(e.children);
  if (W(e))
    return e.data;
  return "";
}
function Ae(e) {
  if (Array.isArray(e))
    return e.map(Ae).join("");
  if (O(e) && !xe(e))
    return Ae(e.children);
  if (W(e))
    return e.data;
  return "";
}
function st(e) {
  if (Array.isArray(e))
    return e.map(st).join("");
  if (O(e) && (e.type === x.Tag || ve(e)))
    return st(e.children);
  if (W(e))
    return e.data;
  return "";
}
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/domutils/lib/esm/traversal.js
function Ke(e) {
  return O(e) ? e.children : [];
}
function zs(e) {
  return e.parent || null;
}
function Lu(e) {
  let t = zs(e);
  if (t != null)
    return Ke(t);
  let u = [e], { prev: s, next: i } = e;
  while (s != null)
    u.unshift(s), { prev: s } = s;
  while (i != null)
    u.push(i), { next: i } = i;
  return u;
}
function Sn(e, t) {
  var u;
  return (u = e.attribs) === null || u === void 0 ? void 0 : u[t];
}
function Dn(e, t) {
  return e.attribs != null && Object.prototype.hasOwnProperty.call(e.attribs, t) && e.attribs[t] != null;
}
function Bn(e) {
  return e.name;
}
function kt(e) {
  let { next: t } = e;
  while (t !== null && !p(t))
    ({ next: t } = t);
  return t;
}
function Pt(e) {
  let { prev: t } = e;
  while (t !== null && !p(t))
    ({ prev: t } = t);
  return t;
}
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/domutils/lib/esm/manipulation.js
function oe(e) {
  if (e.prev)
    e.prev.next = e.next;
  if (e.next)
    e.next.prev = e.prev;
  if (e.parent) {
    let t = e.parent.children, u = t.lastIndexOf(e);
    if (u >= 0)
      t.splice(u, 1);
  }
  e.next = null, e.prev = null, e.parent = null;
}
function xn(e, t) {
  let u = t.prev = e.prev;
  if (u)
    u.next = t;
  let s = t.next = e.next;
  if (s)
    s.prev = t;
  let i = t.parent = e.parent;
  if (i) {
    let n = i.children;
    n[n.lastIndexOf(e)] = t, e.parent = null;
  }
}
function On(e, t) {
  if (oe(t), t.next = null, t.parent = e, e.children.push(t) > 1) {
    let u = e.children[e.children.length - 2];
    u.next = t, t.prev = u;
  } else
    t.prev = null;
}
function Rn(e, t) {
  oe(t);
  let { parent: u } = e, s = e.next;
  if (t.next = s, t.prev = e, e.next = t, t.parent = u, s) {
    if (s.prev = t, u) {
      let i = u.children;
      i.splice(i.lastIndexOf(s), 0, t);
    }
  } else if (u)
    u.children.push(t);
}
function Ln(e, t) {
  if (oe(t), t.parent = e, t.prev = null, e.children.unshift(t) !== 1) {
    let u = e.children[1];
    u.prev = t, t.next = u;
  } else
    t.next = null;
}
function yn(e, t) {
  oe(t);
  let { parent: u } = e;
  if (u) {
    let s = u.children;
    s.splice(s.indexOf(e), 0, t);
  }
  if (e.prev)
    e.prev.next = t;
  t.parent = u, t.prev = e.prev, t.next = e, e.prev = t;
}
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/domutils/lib/esm/querying.js
function We(e, t, u = !0, s = 1 / 0) {
  return Ht(e, Array.isArray(t) ? t : [t], u, s);
}
function Ht(e, t, u, s) {
  let i = [], n = [Array.isArray(t) ? t : [t]], a = [0];
  for (;; ) {
    if (a[0] >= n[0].length) {
      if (a.length === 1)
        return i;
      n.shift(), a.shift();
      continue;
    }
    let d = n[0][a[0]++];
    if (e(d)) {
      if (i.push(d), --s <= 0)
        return i;
    }
    if (u && O(d) && d.children.length > 0)
      a.unshift(0), n.unshift(d.children);
  }
}
function Fn(e, t) {
  return t.find(e);
}
function Ut(e, t, u = !0) {
  let s = Array.isArray(t) ? t : [t];
  for (let i = 0;i < s.length; i++) {
    let n = s[i];
    if (p(n) && e(n))
      return n;
    if (u && O(n) && n.children.length > 0) {
      let a = Ut(e, n.children, !0);
      if (a)
        return a;
    }
  }
  return null;
}
function $s(e, t) {
  return (Array.isArray(t) ? t : [t]).some((u) => p(u) && e(u) || O(u) && $s(e, u.children));
}
function Mn(e, t) {
  let u = [], s = [Array.isArray(t) ? t : [t]], i = [0];
  for (;; ) {
    if (i[0] >= s[0].length) {
      if (s.length === 1)
        return u;
      s.shift(), i.shift();
      continue;
    }
    let n = s[0][i[0]++];
    if (p(n) && e(n))
      u.push(n);
    if (O(n) && n.children.length > 0)
      i.unshift(0), s.unshift(n.children);
  }
}
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/domutils/lib/esm/legacy.js
var Qt = {
  tag_name(e) {
    if (typeof e === "function")
      return (t) => p(t) && e(t.name);
    else if (e === "*")
      return p;
    return (t) => p(t) && t.name === e;
  },
  tag_type(e) {
    if (typeof e === "function")
      return (t) => e(t.type);
    return (t) => t.type === e;
  },
  tag_contains(e) {
    if (typeof e === "function")
      return (t) => W(t) && e(t.data);
    return (t) => W(t) && t.data === e;
  }
};
function yu(e, t) {
  if (typeof t === "function")
    return (u) => p(u) && t(u.attribs[e]);
  return (u) => p(u) && u.attribs[e] === t;
}
function wn(e, t) {
  return (u) => e(u) || t(u);
}
function er(e) {
  let t = Object.keys(e).map((u) => {
    let s = e[u];
    return Object.prototype.hasOwnProperty.call(Qt, u) ? Qt[u](s) : yu(u, s);
  });
  return t.length === 0 ? null : t.reduce(wn);
}
function kn(e, t) {
  let u = er(e);
  return u ? u(t) : !0;
}
function Pn(e, t, u, s = 1 / 0) {
  let i = er(e);
  return i ? We(i, t, u, s) : [];
}
function Hn(e, t, u = !0) {
  if (!Array.isArray(t))
    t = [t];
  return Ut(yu("id", e), t, u);
}
function Oe(e, t, u = !0, s = 1 / 0) {
  return We(Qt.tag_name(e), t, u, s);
}
function Un(e, t, u = !0, s = 1 / 0) {
  return We(yu("class", e), t, u, s);
}
function Qn(e, t, u = !0, s = 1 / 0) {
  return We(Qt.tag_type(e), t, u, s);
}
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/domutils/lib/esm/helpers.js
function Yn(e) {
  let t = e.length;
  while (--t >= 0) {
    let u = e[t];
    if (t > 0 && e.lastIndexOf(u, t - 1) >= 0) {
      e.splice(t, 1);
      continue;
    }
    for (let s = u.parent;s; s = s.parent)
      if (e.includes(s)) {
        e.splice(t, 1);
        break;
      }
  }
  return e;
}
var V;
(function(e) {
  e[e.DISCONNECTED = 1] = "DISCONNECTED", e[e.PRECEDING = 2] = "PRECEDING", e[e.FOLLOWING = 4] = "FOLLOWING", e[e.CONTAINS = 8] = "CONTAINS", e[e.CONTAINED_BY = 16] = "CONTAINED_BY";
})(V || (V = {}));
function tr(e, t) {
  let u = [], s = [];
  if (e === t)
    return 0;
  let i = O(e) ? e : e.parent;
  while (i)
    u.unshift(i), i = i.parent;
  i = O(t) ? t : t.parent;
  while (i)
    s.unshift(i), i = i.parent;
  let n = Math.min(u.length, s.length), a = 0;
  while (a < n && u[a] === s[a])
    a++;
  if (a === 0)
    return V.DISCONNECTED;
  let d = u[a - 1], l = d.children, f = u[a], T = s[a];
  if (l.indexOf(f) > l.indexOf(T)) {
    if (d === t)
      return V.FOLLOWING | V.CONTAINED_BY;
    return V.FOLLOWING;
  }
  if (d === e)
    return V.PRECEDING | V.CONTAINS;
  return V.PRECEDING;
}
function ge(e) {
  return e = e.filter((t, u, s) => !s.includes(t, u + 1)), e.sort((t, u) => {
    let s = tr(t, u);
    if (s & V.PRECEDING)
      return -1;
    else if (s & V.FOLLOWING)
      return 1;
    return 0;
  }), e;
}
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/domutils/lib/esm/feeds.js
function vn(e) {
  let t = Yt(Zn, e);
  return !t ? null : t.name === "feed" ? Gn(t) : Kn(t);
}
function Gn(e) {
  var t;
  let u = e.children, s = {
    type: "atom",
    items: Oe("entry", u).map((a) => {
      var d;
      let { children: l } = a, f = { media: ur(l) };
      J(f, "id", "id", l), J(f, "title", "title", l);
      let T = (d = Yt("link", l)) === null || d === void 0 ? void 0 : d.attribs.href;
      if (T)
        f.link = T;
      let C = be("summary", l) || be("content", l);
      if (C)
        f.description = C;
      let I = be("updated", l);
      if (I)
        f.pubDate = new Date(I);
      return f;
    })
  };
  J(s, "id", "id", u), J(s, "title", "title", u);
  let i = (t = Yt("link", u)) === null || t === void 0 ? void 0 : t.attribs.href;
  if (i)
    s.link = i;
  J(s, "description", "subtitle", u);
  let n = be("updated", u);
  if (n)
    s.updated = new Date(n);
  return J(s, "author", "email", u, !0), s;
}
function Kn(e) {
  var t, u;
  let s = (u = (t = Yt("channel", e.children)) === null || t === void 0 ? void 0 : t.children) !== null && u !== void 0 ? u : [], i = {
    type: e.name.substr(0, 3),
    id: "",
    items: Oe("item", e.children).map((a) => {
      let { children: d } = a, l = { media: ur(d) };
      J(l, "id", "guid", d), J(l, "title", "title", d), J(l, "link", "link", d), J(l, "description", "description", d);
      let f = be("pubDate", d) || be("dc:date", d);
      if (f)
        l.pubDate = new Date(f);
      return l;
    })
  };
  J(i, "title", "title", s), J(i, "link", "link", s), J(i, "description", "description", s);
  let n = be("lastBuildDate", s);
  if (n)
    i.updated = new Date(n);
  return J(i, "author", "managingEditor", s, !0), i;
}
var Wn = ["url", "type", "lang"], Jn = [
  "fileSize",
  "bitrate",
  "framerate",
  "samplingrate",
  "channels",
  "duration",
  "height",
  "width"
];
function ur(e) {
  return Oe("media:content", e).map((t) => {
    let { attribs: u } = t, s = {
      medium: u.medium,
      isDefault: !!u.isDefault
    };
    for (let i of Wn)
      if (u[i])
        s[i] = u[i];
    for (let i of Jn)
      if (u[i])
        s[i] = parseInt(u[i], 10);
    if (u.expression)
      s.expression = u.expression;
    return s;
  });
}
function Yt(e, t) {
  return Oe(e, t, !0, 1)[0];
}
function be(e, t, u = !1) {
  return Ae(Oe(e, t, u, 1)).trim();
}
function J(e, t, u, s, i = !1) {
  let n = be(u, s, i);
  if (n)
    e[t] = n;
}
function Zn(e) {
  return e === "rss" || e === "feed" || e === "rdf:RDF";
}
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/static.js
function rr(e, t, u) {
  if (!e)
    return "";
  return e(t !== null && t !== void 0 ? t : e._root.children, null, void 0, u).toString();
}
function Xn(e, t) {
  return !t && typeof e === "object" && e != null && !("length" in e) && !("type" in e);
}
function Vn(e, t) {
  let u = Xn(e) ? (t = e, void 0) : e, s = {
    ...this === null || this === void 0 ? void 0 : this._options,
    ...tt(t)
  };
  return rr(this, u, s);
}
function qn(e) {
  let t = { ...this._options, xmlMode: !0 };
  return rr(this, e, t);
}
function Re(e) {
  let t = e !== null && e !== void 0 ? e : this ? this.root() : [], u = "";
  for (let s = 0;s < t.length; s++)
    u += Ae(t[s]);
  return u;
}
function jn(e, t, u = typeof t === "boolean" ? t : !1) {
  if (!e || typeof e !== "string")
    return null;
  if (typeof t === "boolean")
    u = t;
  let s = this.load(e, this._options, !1);
  if (!u)
    s("script").remove();
  return [...s.root()[0].children];
}
function zn() {
  return this(this._root);
}
function vt(e, t) {
  if (t === e)
    return !1;
  let u = t;
  while (u && u !== u.parent)
    if (u = u.parent, u === e)
      return !0;
  return !1;
}
function $n(e) {
  return this.root().extract(e);
}
function ir(e, t) {
  if (!sr(e) || !sr(t))
    return;
  let u = e.length, s = +t.length;
  for (let i = 0;i < s; i++)
    e[u++] = t[i];
  return e.length = u, e;
}
function sr(e) {
  if (Array.isArray(e))
    return !0;
  if (typeof e !== "object" || e === null || !("length" in e) || typeof e.length !== "number" || e.length < 0)
    return !1;
  for (let t = 0;t < e.length; t++)
    if (!(t in e))
      return !1;
  return !0;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/utils.js
function q(e) {
  return e.cheerio != null;
}
function nr(e) {
  return e.replace(/[._-](\w|$)/g, (t, u) => u.toUpperCase());
}
function ar(e) {
  return e.replace(/[A-Z]/g, "-$&").toLowerCase();
}
function L(e, t) {
  let u = e.length;
  for (let s = 0;s < u; s++)
    t(e[s], s);
  return e;
}
var Le;
(function(e) {
  e[e.LowerA = 97] = "LowerA", e[e.LowerZ = 122] = "LowerZ", e[e.UpperA = 65] = "UpperA", e[e.UpperZ = 90] = "UpperZ", e[e.Exclamation = 33] = "Exclamation";
})(Le || (Le = {}));
function rt(e) {
  if (typeof e !== "string")
    return !1;
  let t = e.indexOf("<");
  if (t === -1 || t > e.length - 3)
    return !1;
  let u = e.charCodeAt(t + 1);
  return (u >= Le.LowerA && u <= Le.LowerZ || u >= Le.UpperA && u <= Le.UpperZ || u === Le.Exclamation) && e.includes(">", t + 2);
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/htmlparser2/node_modules/entities/dist/esm/decode-codepoint.js
var Mu, ea = /* @__PURE__ */ new Map([
  [0, 65533],
  [128, 8364],
  [130, 8218],
  [131, 402],
  [132, 8222],
  [133, 8230],
  [134, 8224],
  [135, 8225],
  [136, 710],
  [137, 8240],
  [138, 352],
  [139, 8249],
  [140, 338],
  [142, 381],
  [145, 8216],
  [146, 8217],
  [147, 8220],
  [148, 8221],
  [149, 8226],
  [150, 8211],
  [151, 8212],
  [152, 732],
  [153, 8482],
  [154, 353],
  [155, 8250],
  [156, 339],
  [158, 382],
  [159, 376]
]), it = (Mu = String.fromCodePoint) !== null && Mu !== void 0 ? Mu : (e) => {
  let t = "";
  if (e > 65535)
    e -= 65536, t += String.fromCharCode(e >>> 10 & 1023 | 55296), e = 56320 | e & 1023;
  return t += String.fromCharCode(e), t;
};
function wu(e) {
  var t;
  if (e >= 55296 && e <= 57343 || e > 1114111)
    return 65533;
  return (t = ea.get(e)) !== null && t !== void 0 ? t : e;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/htmlparser2/node_modules/entities/dist/esm/internal/decode-shared.js
function Gt(e) {
  let t = typeof atob === "function" ? atob(e) : typeof Buffer.from === "function" ? Buffer.from(e, "base64").toString("binary") : new Buffer(e, "base64").toString("binary"), u = t.length & -2, s = new Uint16Array(u / 2);
  for (let i = 0, n = 0;i < u; i += 2) {
    let a = t.charCodeAt(i), d = t.charCodeAt(i + 1);
    s[n++] = a | d << 8;
  }
  return s;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/htmlparser2/node_modules/entities/dist/esm/generated/decode-data-html.js
var ku = /* @__PURE__ */ Gt("QR08ALkAAgH6AYsDNQR2BO0EPgXZBQEGLAbdBxMISQrvCmQLfQurDKQNLw4fD4YPpA+6D/IPAAAAAAAAAAAAAAAAKhBMEY8TmxUWF2EYLBkxGuAa3RsJHDscWR8YIC8jSCSIJcMl6ie3Ku8rEC0CLjoupS7kLgAIRU1hYmNmZ2xtbm9wcnN0dVQAWgBeAGUAaQBzAHcAfgCBAIQAhwCSAJoAoACsALMAbABpAGcAO4DGAMZAUAA7gCYAJkBjAHUAdABlADuAwQDBQHIiZXZlAAJhAAFpeW0AcgByAGMAO4DCAMJAEGRyAADgNdgE3XIAYQB2AGUAO4DAAMBA8CFoYZFj4SFjcgBhZAAAoFMqAAFncIsAjgBvAG4ABGFmAADgNdg43fAlbHlGdW5jdGlvbgCgYSBpAG4AZwA7gMUAxUAAAWNzpACoAHIAAOA12Jzc6SFnbgCgVCJpAGwAZABlADuAwwDDQG0AbAA7gMQAxEAABGFjZWZvcnN1xQDYANoA7QDxAPYA+QD8AAABY3LJAM8AayNzbGFzaAAAoBYidgHTANUAAKDnKmUAZAAAoAYjeQARZIABY3J0AOAA5QDrAGEidXNlAACgNSLuI291bGxpcwCgLCFhAJJjcgAA4DXYBd1wAGYAAOA12Dnd5SF2ZdhiYwDyAOoAbSJwZXEAAKBOIgAHSE9hY2RlZmhpbG9yc3UXARoBHwE6AVIBVQFiAWQBZgGCAakB6QHtAfIBYwB5ACdkUABZADuAqQCpQIABY3B5ACUBKAE1AfUhdGUGYWmg0iJ0KGFsRGlmZmVyZW50aWFsRAAAoEUhbCJleXMAAKAtIQACYWVpb0EBRAFKAU0B8iFvbgxhZABpAGwAO4DHAMdAcgBjAAhhbiJpbnQAAKAwIm8AdAAKYQABZG5ZAV0BaSJsbGEAuGB0I2VyRG90ALdg8gA5AWkAp2NyImNsZQAAAkRNUFRwAXQBeQF9AW8AdAAAoJkiaSJudXMAAKCWIuwhdXMAoJUiaSJtZXMAAKCXIm8AAAFjc4cBlAFrKndpc2VDb250b3VySW50ZWdyYWwAAKAyImUjQ3VybHkAAAFEUZwBpAFvJXVibGVRdW90ZQAAoB0gdSJvdGUAAKAZIAACbG5wdbABtgHNAdgBbwBuAGWgNyIAoHQqgAFnaXQAvAHBAcUB8iJ1ZW50AKBhIm4AdAAAoC8i7yV1ckludGVncmFsAKAuIgABZnLRAdMBAKACIe8iZHVjdACgECJuLnRlckNsb2Nrd2lzZUNvbnRvdXJJbnRlZ3JhbAAAoDMi7yFzcwCgLypjAHIAAOA12J7ccABDoNMiYQBwAACgTSKABURKU1phY2VmaW9zAAsCEgIVAhgCGwIsAjQCOQI9AnMCfwNvoEUh9CJyYWhkAKARKWMAeQACZGMAeQAFZGMAeQAPZIABZ3JzACECJQIoAuchZXIAoCEgcgAAoKEhaAB2AACg5CoAAWF5MAIzAvIhb24OYRRkbAB0oAciYQCUY3IAAOA12AfdAAFhZkECawIAAWNtRQJnAvIjaXRpY2FsAAJBREdUUAJUAl8CYwJjInV0ZQC0YG8AdAFZAloC2WJiJGxlQWN1dGUA3WJyImF2ZQBgYGkibGRlANxi7yFuZACgxCJmJWVyZW50aWFsRAAAoEYhcAR9AgAAAAAAAIECjgIAABoDZgAA4DXYO91EoagAhQKJAm8AdAAAoNwgcSJ1YWwAAKBQIuIhbGUAA0NETFJVVpkCqAK1Au8C/wIRA28AbgB0AG8AdQByAEkAbgB0AGUAZwByAGEA7ADEAW8AdAKvAgAAAACwAqhgbiNBcnJvdwAAoNMhAAFlb7kC0AJmAHQAgAFBUlQAwQLGAs0CciJyb3cAAKDQIekkZ2h0QXJyb3cAoNQhZQDlACsCbgBnAAABTFLWAugC5SFmdAABQVLcAuECciJyb3cAAKD4J+kkZ2h0QXJyb3cAoPon6SRnaHRBcnJvdwCg+SdpImdodAAAAUFU9gL7AnIicm93AACg0iFlAGUAAKCoInAAQQIGAwAAAAALA3Iicm93AACg0SFvJHduQXJyb3cAAKDVIWUlcnRpY2FsQmFyAACgJSJuAAADQUJMUlRhJAM2AzoDWgNxA3oDciJyb3cAAKGTIUJVLAMwA2EAcgAAoBMpcCNBcnJvdwAAoPUhciJldmUAEWPlIWZ00gJDAwAASwMAAFIDaSVnaHRWZWN0b3IAAKBQKWUkZVZlY3RvcgAAoF4p5SJjdG9yQqC9IWEAcgAAoFYpaSJnaHQA1AFiAwAAaQNlJGVWZWN0b3IAAKBfKeUiY3RvckKgwSFhAHIAAKBXKWUAZQBBoKQiciJyb3cAAKCnIXIAcgBvAPcAtAIAAWN0gwOHA3IA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YwAAoN8i4SFycnCgtiEAoD0pgKIqImJjZG9zACsVMBU6FT4VQRVyImNhcAAAoEgqAAFhdTQVNxVwAACgRipwAACgSipvAHQAAKCNInIAAKBFKgDgKiIA/gACYWxydksVURVuFXMVcgByAG2gtyEAoDwpeQCAAWV2dwBYFWUVaRVxAHACXxUAAAAAYxVyAGUA4wAXFXUA4wAZFWUAZQAAoM4iZSJkZ2UAAKDPImUAbgA7gKQApEBlI2Fycm93AAABbHJ7FX8V5SFmdACgtiFpImdodAAAoLchZQDkAG0VAAFjaYsVkRVvAG4AaQBuAPQAkwFuAHQAAKAxImwiY3R5AACgLSOACUFIYWJjZGVmaGlqbG9yc3R1d3oAuBW7Fb8V1RXgFegV+RUKFhUWHxZUFlcWZRbFFtsW7xb7FgUXChdyAPIAtAJhAHIAAKBlKQACZ2xyc8YVyhXOFdAV5yFlcgCgICDlIXRoAKA4IfIA9QxoAHagECAAoKMiawHZFd4VYSJyb3cAAKAPKWEA4wBfAgABYXnkFecV8iFvbg9hNGQAoUYhYW/tFfQVAAFnciEC8RVyAACgyiF0InNlcQAAoHcqgAFnbG0A/xUCFgUWO4CwALBAdABhALRjcCJ0eXYAAKCxKQABaXIOFhIW8yFodACgfykA4DXYId1hAHIAAAFschsWHRYAoMMhAKDCIYACYWVnc3YAKBauAjYWOhY+Fm0AAKHEIm9zLhY0Fm4AZABzoMQi9SFpdACgZiZhIm1tYQDdY2kAbgAAoPIiAKH3AGlvQxZRFmQAZQAAgfcAO29KFksW90BuI3RpbWVzAACgxyJuAPgAUBZjAHkAUmRjAG8CXhYAAAAAYhZyAG4AAKAeI28AcAAAoA0jgAJscHR1dwBuFnEWdRaSFp4W7CFhciRgZgAA4DXYVd0AotkCZW1wc30WhBaJFo0WcQBkoFAibwB0AACgUSJpIm51cwAAoDgi7CF1cwCgFCLxInVhcmUAoKEiYgBsAGUAYgBhAHIAdwBlAGQAZwDlANcAbgCAAWFkaAClFqoWtBZyAHIAbwD3APUMbwB3AG4AYQByAHIAbwB3APMA8xVhI3Jwb29uAAABbHK8FsAWZQBmAPQAHBZpAGcAaAD0AB4WYgHJFs8WawBhAHIAbwD3AJILbwLUFgAAAADYFnIAbgAAoB8jbwBwAACgDCOAAWNvdADhFukW7BYAAXJ55RboFgDgNdi53FVkbAAAoPYp8iFvaxFhAAFkcvMW9xZvAHQAAKDxImkA5qC/JVsSAAFhaP8WAhdyAPIANQNhAPIA1wvhIm5nbGUAoKYpAAFjaQ4XEBd5AF9k5yJyYXJyAKD/JwAJRGFjZGVmZ2xtbm9wcXJzdHV4MRc4F0YXWxcyBF4XaRd5F40XrBe0F78X2RcVGCEYLRg1GEAYAAFEbzUXgRZvAPQA+BUAAWNzPBdCF3UAdABlADuA6QDpQPQhZXIAoG4qAAJhaW95TRdQF1YXWhfyIW9uG2FyAGOgViI7gOoA6kDsIW9uAKBVIk1kbwB0ABdhAAFEcmIXZhdvAHQAAKBSIgDgNdgi3XKhmipuF3QXYQB2AGUAO4DoAOhAZKCWKm8AdAAAoJgqgKGZKmlscwCAF4UXhxfuInRlcnMAoOcjAKATIWSglSpvAHQAAKCXKoABYXBzAJMXlheiF2MAcgATYXQAeQBzogUinxcAAAAAoRdlAHQAAKAFInAAMaADIDMBqRerFwCgBCAAoAUgAAFnc7AXsRdLYXAAAKACIAABZ3C4F7sXbwBuABlhZgAA4DXYVt2AAWFscwDFF8sXzxdyAHOg1SJsAACg4yl1AHMAAKBxKmkAAKG1A2x21RfYF28AbgC1Y/VjAAJjc3V24BfoF/0XEBgAAWlv5BdWF3IAYwAAoFYiaQLuFwAAAADwF+0ADQThIW50AAFnbPUX+Rd0AHIAAKCWKuUhc3MAoJUqgAFhZWkAAxgGGAoYbABzAD1gcwB0AACgXyJ2AESgYSJEAACgeCrwImFyc2wAoOUpAAFEYRkYHRhvAHQAAKBTInIAcgAAoHEpgAFjZGkAJxgqGO0XcgAAoC8hbwD0AIwCAAFhaDEYMhi3YzuA8ADwQAABbXI5GD0YbAA7gOsA60BvAACgrCCAAWNpcABGGEgYSxhsACFgcwD0ACwEAAFlb08YVxhjAHQAYQB0AGkAbwDuABoEbgBlAG4AdABpAGEAbADlADME4Ql1GAAAgRgAAIMYiBgAAAAAoRilGAAAqhgAALsYvhjRGAAA1xgnGWwAbABpAG4AZwBkAG8AdABzAGUA8QBlF3kARGRtImFsZQAAoEAmgAFpbHIAjRiRGJ0Y7CFpZwCgA/tpApcYAAAAAJoYZwAAoAD7aQBnAACgBPsA4DXYI93sIWlnAKAB++whaWcA4GYAagCAAWFsdACvGLIYthh0AACgbSZpAGcAAKAC+24AcwAAoLElbwBmAJJh8AHCGAAAxhhmAADgNdhX3QABYWvJGMwYbADsAGsEdqDUIgCg2SphI3J0aW50AACgDSoAAWFv2hgiGQABY3PeGB8ZsQPnGP0YBRkSGRUZAAAdGbID7xjyGPQY9xj5GAAA+xg7gL0AvUAAoFMhO4C8ALxAAKBVIQCgWSEAoFshswEBGQAAAxkAoFQhAKBWIbQCCxkOGQAAAAAQGTuAvgC+QACgVyEAoFwhNQAAoFghtgEZGQAAGxkAoFohAKBdITgAAKBeIWwAAKBEIHcAbgAAoCIjYwByAADgNdi73IAIRWFiY2RlZmdpamxub3JzdHYARhlKGVoZXhlmGWkZkhmWGZkZnRmgGa0ZxhnLGc8Z4BkjGmygZyIAoIwqgAFjbXAAUBlTGVgZ9SF0ZfVhbQBhAOSgswM6FgCghipyImV2ZQAfYQABaXliGWUZcgBjAB1hM2RvAHQAIWGAoWUibHFzAMYEcBl6GfGhZSLOBAAAdhlsAGEAbgD0AN8EgKF+KmNkbACBGYQZjBljAACgqSpvAHQAb6CAKmyggioAoIQqZeDbIgD+cwAAoJQqcgAA4DXYJN3noGsirATtIWVsAKA3IWMAeQBTZIChdyJFYWoApxmpGasZAKCSKgCgpSoAoKQqAAJFYWVztBm2Gb0ZwhkAoGkicABwoIoq8iFveACgiipxoIgq8aCIKrUZaQBtAACg5yJwAGYAAOA12FjdYQB2AOUAYwIAAWNp0xnWGXIAAKAKIW0AAKFzImVs3BneGQCgjioAoJAqAIM+ADtjZGxxco0E6xn0GfgZ/BkBGgABY2nvGfEZAKCnKnIAAKB6Km8AdAAAoNci0CFhcgCglSl1ImVzdAAAoHwqgAJhZGVscwAKGvQZFhrVBCAa8AEPGgAAFBpwAHIAbwD4AFkZcgAAoHgpcQAAAWxxxAQbGmwAZQBzAPMASRlpAO0A5AQAAWVuJxouGnIjdG5lcXEAAOBpIgD+xQAsGgAFQWFiY2Vma29zeUAaQxpmGmoabRqDGocalhrCGtMacgDyAMwCAAJpbG1yShpOGlAaVBpyAHMA8ABxD2YAvWBpAGwA9AASBQABZHJYGlsaYwB5AEpkAKGUIWN3YBpkGmkAcgAAoEgpAKCtIWEAcgAAoA8h6SFyYyVhgAFhbHIAcxp7Gn8a8iF0c3WgZSZpAHQAAKBlJuwhaXAAoCYg4yFvbgCguSJyAADgNdgl3XMAAAFld4wakRphInJvdwAAoCUpYSJyb3cAAKAmKYACYW1vcHIAnxqjGqcauhq+GnIAcgAAoP8h9CFodACgOyJrAAABbHKsGrMaZSRmdGFycm93AACgqSHpJGdodGFycm93AKCqIWYAAOA12Fnd4iFhcgCgFSCAAWNsdADIGswa0BpyAADgNdi93GEAcwDoAGka8iFvaydhAAFicNca2xr1IWxsAKBDIOghZW4AoBAg4Qr2GgAA/RoAAAgbExsaGwAAIRs7GwAAAAA+G2IbmRuVG6sbAACyG80b0htjAHUAdABlADuA7QDtQAChYyBpeQEbBhtyAGMAO4DuAO5AOGQAAWN4CxsNG3kANWRjAGwAO4ChAKFAAAFmcssCFhsA4DXYJt1yAGEAdgBlADuA7ADsQIChSCFpbm8AJxsyGzYbAAFpbisbLxtuAHQAAKAMKnQAAKAtIuYhaW4AoNwpdABhAACgKSHsIWlnM2GAAWFvcABDG1sbXhuAAWNndABJG0sbWRtyACthgAFlbHAAcQVRG1UbaQBuAOUAyAVhAHIA9AByBWgAMWFmAACgtyJlAGQAtWEAoggiY2ZvdGkbbRt1G3kb4SFyZQCgBSFpAG4AdKAeImkAZQAAoN0pZABvAPQAWxsAoisiY2VscIEbhRuPG5QbYQBsAACguiIAAWdyiRuNG2UAcgDzACMQ4wCCG2EicmhrAACgFyryIW9kAKA8KgACY2dwdJ8boRukG6gbeQBRZG8AbgAvYWYAAOA12FrdYQC5Y3UAZQBzAHQAO4C/AL9AAAFjabUbuRtyAADgNdi+3G4AAKIIIkVkc3bCG8QbyBvQAwCg+SJvAHQAAKD1Inag9CIAoPMiaaBiIOwhZGUpYesB1hsAANkbYwB5AFZkbAA7gO8A70AAA2NmbW9zdeYb7hvyG/Ub+hsFHAABaXnqG+0bcgBjADVhOWRyAADgNdgn3eEhdGg3YnAAZgAA4DXYW93jAf8bAAADHHIAAOA12L/c8iFjeVhk6yFjeVRkAARhY2ZnaGpvcxUcGhwiHCYcKhwtHDAcNRzwIXBhdqC6A/BjAAFleR4cIRzkIWls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ZmdobG1vcHJzdHV3CiwNLBEsHSwnLDEsQCxLLFIsYix6LIQsjyzLLOgs7Sz/LAotcgDyAAkDYQByAACgYykAAWNyFSwbLHUAdABlADuA+gD6QPIACQ1yAOMBIywAACUseQBeZHYAZQBtYQABaXkrLDAscgBjADuA+wD7QENkgAFhYmgANyw6LD0scgDyANEO7CFhY3FhYQDyAOAOAAFpckQsSCzzIWh0AKB+KQDgNdgy3XIAYQB2AGUAO4D5APlAYQFWLF8scgAAAWxyWixcLACgvyEAoL4hbABrAACggCUAAWN0Zix2LG8CbCwAAAAAcyxyAG4AZaAcI3IAAKAcI28AcAAAoA8jcgBpAACg+CUAAWFsfiyBLGMAcgBrYTuAqACoQAABZ3CILIssbwBuAHNhZgAA4DXYZt0AA2FkaGxzdZksniynLLgsuyzFLHIAcgBvAPcACQ1vAHcAbgBhAHIAcgBvAPcA2A5hI3Jwb29uAAABbHKvLLMsZQBmAPQAWyxpAGcAaAD0AF0sdQDzAKYOaQAAocUDaGzBLMIs0mNvAG4AxWPwI2Fycm93cwCgyCGAAWNpdADRLOEs5CxvAtcsAAAAAN4scgBuAGWgHSNyAACgHSNvAHAAAKAOI24AZwBvYXIAaQAAoPklYwByAADgNdjK3IABZGlyAPMs9yz6LG8AdAAAoPAi7CFkZWlhaQBmoLUlAKC0JQABYW0DLQYtcgDyAMosbAA7gPwA/EDhIm5nbGUAoKcpgAdBQkRhY2RlZmxub3Byc3oAJy0qLTAtNC2bLZ0toS2/LcMtxy3TLdgt3C3gLfwtcgDyABADYQByAHag6CoAoOkqYQBzAOgA/gIAAW5yOC08LechcnQAoJwpgANla25wcnN0AJkpSC1NLVQtXi1iLYItYQBwAHAA4QAaHG8AdABoAGkAbgDnAKEXgAFoaXIAoSmzJFotbwBwAPQAdCVooJUh7wD4JgABaXVmLWotZwBtAOEAuygAAWJwbi14LXMjZXRuZXEAceCKIgD+AODLKgD+cyNldG5lcQBx4IsiAP4A4MwqAP4AAWhyhi2KLWUAdADhABIraSNhbmdsZQAAAWxyki2WLeUhZnQAoLIiaSJnaHQAAKCzInkAMmThIXNoAKCiIoABZWxyAKcttC24LWKiKCKuLQAAAACyLWEAcgAAoLsicQAAoFoi7CFpcACg7iIAAWJ0vC1eD2EA8gBfD3IAAOA12DPddAByAOkAlS1zAHUAAAFicM0t0C0A4IIi0iAA4IMi0iBwAGYAAOA12GfdcgBvAPAAWQt0AHIA6QCaLQABY3XkLegtcgAA4DXYy9wAAWJw7C30LW4AAAFFZXUt8S0A4IoiAP5uAAABRWV/LfktAOCLIgD+6SJnemFnAKCaKYADY2Vmb3BycwANLhAuJS4pLiMuLi40LukhcmN1YQABZGkULiEuAAFiZxguHC5hAHIAAKBfKmUAcaAnIgCgWSLlIXJwAKAYIXIAAOA12DTdcABmAADgNdho3WWgQCJhAHQA6ABqD2MAcgAA4DXYzNzjCuQRUC4AAFQuAABYLmIuAAAAAGMubS5wLnQuAAAAAIguki4AAJouJxIqEnQAcgDpAB0ScgAA4DXYNd0AAUFhWy5eLnIA8gDnAnIA8gCTB75jAAFBYWYuaS5yAPIA4AJyAPIAjAdhAPAAeh5pAHMAAKD7IoABZHB0APgReS6DLgABZmx9LoAuAOA12GnddQDzAP8RaQBtAOUABBIAAUFhiy6OLnIA8gDuAnIA8gCaBwABY3GVLgoScgAA4DXYzdwAAXB0nS6hLmwAdQDzACUScgDpACASAARhY2VmaW9zdbEuvC7ELsguzC7PLtQu2S5jAAABdXm2LrsudABlADuA/QD9QE9kAAFpecAuwy5yAGMAd2FLZG4AO4ClAKVAcgAA4DXYNt1jAHkAV2RwAGYAAOA12GrdYwByAADgNdjO3AABY23dLt8ueQBOZGwAO4D/AP9AAAVhY2RlZmhpb3N38y73Lv8uAi8MLxAvEy8YLx0vIi9jInV0ZQB6YQABYXn7Lv4u8iFvbn5hN2RvAHQAfGEAAWV0Bi8KL3QAcgDmAB8QYQC2Y3IAAOA12DfdYwB5ADZk5yJyYXJyAKDdIXAAZgAA4DXYa91jAHIAAOA12M/cAAFqbiYvKC8AoA0gagAAoAwg");

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/htmlparser2/node_modules/entities/dist/esm/generated/decode-data-xml.js
var Pu = /* @__PURE__ */ Gt("AAJhZ2xxBwARABMAFQBtAg0AAAAAAA8AcAAmYG8AcwAnYHQAPmB0ADxg9SFvdCJg");

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/htmlparser2/node_modules/entities/dist/esm/internal/bin-trie-flags.js
var Q;
(function(e) {
  e[e.VALUE_LENGTH = 49152] = "VALUE_LENGTH", e[e.FLAG13 = 8192] = "FLAG13", e[e.BRANCH_LENGTH = 8064] = "BRANCH_LENGTH", e[e.JUMP_TABLE = 127] = "JUMP_TABLE";
})(Q || (Q = {}));

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/htmlparser2/node_modules/entities/dist/esm/decode.js
var F;
(function(e) {
  e[e.NUM = 35] = "NUM", e[e.SEMI = 59] = "SEMI", e[e.EQUALS = 61] = "EQUALS", e[e.ZERO = 48] = "ZERO", e[e.NINE = 57] = "NINE", e[e.LOWER_A = 97] = "LOWER_A", e[e.LOWER_F = 102] = "LOWER_F", e[e.LOWER_X = 120] = "LOWER_X", e[e.LOWER_Z = 122] = "LOWER_Z", e[e.UPPER_A = 65] = "UPPER_A", e[e.UPPER_F = 70] = "UPPER_F", e[e.UPPER_Z = 90] = "UPPER_Z";
})(F || (F = {}));
var cr = 32;
function Hu(e) {
  return e >= F.ZERO && e <= F.NINE;
}
function ta(e) {
  return e >= F.UPPER_A && e <= F.UPPER_F || e >= F.LOWER_A && e <= F.LOWER_F;
}
function ua(e) {
  return e >= F.UPPER_A && e <= F.UPPER_Z || e >= F.LOWER_A && e <= F.LOWER_Z || Hu(e);
}
function sa(e) {
  return e === F.EQUALS || ua(e);
}
var P;
(function(e) {
  e[e.EntityStart = 0] = "EntityStart", e[e.NumericStart = 1] = "NumericStart", e[e.NumericDecimal = 2] = "NumericDecimal", e[e.NumericHex = 3] = "NumericHex", e[e.NamedEntity = 4] = "NamedEntity";
})(P || (P = {}));
var te;
(function(e) {
  e[e.Legacy = 0] = "Legacy", e[e.Strict = 1] = "Strict", e[e.Attribute = 2] = "Attribute";
})(te || (te = {}));

class Uu {
  constructor(e, t, u) {
    this.decodeTree = e, this.emitCodePoint = t, this.errors = u, this.state = P.EntityStart, this.consumed = 1, this.result = 0, this.treeIndex = 0, this.excess = 1, this.decodeMode = te.Strict, this.runConsumed = 0;
  }
  startEntity(e) {
    this.decodeMode = e, this.state = P.EntityStart, this.result = 0, this.treeIndex = 0, this.excess = 1, this.consumed = 1, this.runConsumed = 0;
  }
  write(e, t) {
    switch (this.state) {
      case P.EntityStart: {
        if (e.charCodeAt(t) === F.NUM)
          return this.state = P.NumericStart, this.consumed += 1, this.stateNumericStart(e, t + 1);
        return this.state = P.NamedEntity, this.stateNamedEntity(e, t);
      }
      case P.NumericStart:
        return this.stateNumericStart(e, t);
      case P.NumericDecimal:
        return this.stateNumericDecimal(e, t);
      case P.NumericHex:
        return this.stateNumericHex(e, t);
      case P.NamedEntity:
        return this.stateNamedEntity(e, t);
    }
  }
  stateNumericStart(e, t) {
    if (t >= e.length)
      return -1;
    if ((e.charCodeAt(t) | cr) === F.LOWER_X)
      return this.state = P.NumericHex, this.consumed += 1, this.stateNumericHex(e, t + 1);
    return this.state = P.NumericDecimal, this.stateNumericDecimal(e, t);
  }
  stateNumericHex(e, t) {
    while (t < e.length) {
      let u = e.charCodeAt(t);
      if (Hu(u) || ta(u)) {
        let s = u <= F.NINE ? u - F.ZERO : (u | cr) - F.LOWER_A + 10;
        this.result = this.result * 16 + s, this.consumed++, t++;
      } else
        return this.emitNumericEntity(u, 3);
    }
    return -1;
  }
  stateNumericDecimal(e, t) {
    while (t < e.length) {
      let u = e.charCodeAt(t);
      if (Hu(u))
        this.result = this.result * 10 + (u - F.ZERO), this.consumed++, t++;
      else
        return this.emitNumericEntity(u, 2);
    }
    return -1;
  }
  emitNumericEntity(e, t) {
    var u;
    if (this.consumed <= t)
      return (u = this.errors) === null || u === void 0 || u.absenceOfDigitsInNumericCharacterReference(this.consumed), 0;
    if (e === F.SEMI)
      this.consumed += 1;
    else if (this.decodeMode === te.Strict)
      return 0;
    if (this.emitCodePoint(wu(this.result), this.consumed), this.errors) {
      if (e !== F.SEMI)
        this.errors.missingSemicolonAfterCharacterReference();
      this.errors.validateNumericCharacterReference(this.result);
    }
    return this.consumed;
  }
  stateNamedEntity(e, t) {
    let { decodeTree: u } = this, s = u[this.treeIndex], i = (s & Q.VALUE_LENGTH) >> 14;
    while (t < e.length) {
      if (i === 0 && (s & Q.FLAG13) !== 0) {
        let a = (s & Q.BRANCH_LENGTH) >> 7;
        if (this.runConsumed === 0) {
          let d = s & Q.JUMP_TABLE;
          if (e.charCodeAt(t) !== d)
            return this.result === 0 ? 0 : this.emitNotTerminatedNamedEntity();
          t++, this.excess++, this.runConsumed++;
        }
        while (this.runConsumed < a) {
          if (t >= e.length)
            return -1;
          let d = this.runConsumed - 1, l = u[this.treeIndex + 1 + (d >> 1)], f = d % 2 === 0 ? l & 255 : l >> 8 & 255;
          if (e.charCodeAt(t) !== f)
            return this.runConsumed = 0, this.result === 0 ? 0 : this.emitNotTerminatedNamedEntity();
          t++, this.excess++, this.runConsumed++;
        }
        this.runConsumed = 0, this.treeIndex += 1 + (a >> 1), s = u[this.treeIndex], i = (s & Q.VALUE_LENGTH) >> 14;
      }
      if (t >= e.length)
        break;
      let n = e.charCodeAt(t);
      if (n === F.SEMI && i !== 0 && (s & Q.FLAG13) !== 0)
        return this.emitNamedEntityData(this.treeIndex, i, this.consumed + this.excess);
      if (this.treeIndex = ra(u, s, this.treeIndex + Math.max(1, i), n), this.treeIndex < 0)
        return this.result === 0 || this.decodeMode === te.Attribute && (i === 0 || sa(n)) ? 0 : this.emitNotTerminatedNamedEntity();
      if (s = u[this.treeIndex], i = (s & Q.VALUE_LENGTH) >> 14, i !== 0) {
        if (n === F.SEMI)
          return this.emitNamedEntityData(this.treeIndex, i, this.consumed + this.excess);
        if (this.decodeMode !== te.Strict && (s & Q.FLAG13) === 0)
          this.result = this.treeIndex, this.consumed += this.excess, this.excess = 0;
      }
      t++, this.excess++;
    }
    return -1;
  }
  emitNotTerminatedNamedEntity() {
    var e;
    let { result: t, decodeTree: u } = this, s = (u[t] & Q.VALUE_LENGTH) >> 14;
    return this.emitNamedEntityData(t, s, this.consumed), (e = this.errors) === null || e === void 0 || e.missingSemicolonAfterCharacterReference(), this.consumed;
  }
  emitNamedEntityData(e, t, u) {
    let { decodeTree: s } = this;
    if (this.emitCodePoint(t === 1 ? s[e] & ~(Q.VALUE_LENGTH | Q.FLAG13) : s[e + 1], u), t === 3)
      this.emitCodePoint(s[e + 2], u);
    return u;
  }
  end() {
    var e;
    switch (this.state) {
      case P.NamedEntity:
        return this.result !== 0 && (this.decodeMode !== te.Attribute || this.result === this.treeIndex) ? this.emitNotTerminatedNamedEntity() : 0;
      case P.NumericDecimal:
        return this.emitNumericEntity(0, 2);
      case P.NumericHex:
        return this.emitNumericEntity(0, 3);
      case P.NumericStart:
        return (e = this.errors) === null || e === void 0 || e.absenceOfDigitsInNumericCharacterReference(this.consumed), 0;
      case P.EntityStart:
        return 0;
    }
  }
}
function ra(e, t, u, s) {
  let i = (t & Q.BRANCH_LENGTH) >> 7, n = t & Q.JUMP_TABLE;
  if (i === 0)
    return n !== 0 && s === n ? u : -1;
  if (n) {
    let f = s - n;
    return f < 0 || f >= i ? -1 : e[u + f] - 1;
  }
  let a = i + 1 >> 1, d = 0, l = i - 1;
  while (d <= l) {
    let f = d + l >>> 1, T = f >> 1, I = e[u + T] >> (f & 1) * 8 & 255;
    if (I < s)
      d = f + 1;
    else if (I > s)
      l = f - 1;
    else
      return e[u + a + f];
  }
  return -1;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/htmlparser2/dist/esm/Tokenizer.js
var N;
(function(e) {
  e[e.Tab = 9] = "Tab", e[e.NewLine = 10] = "NewLine", e[e.FormFeed = 12] = "FormFeed", e[e.CarriageReturn = 13] = "CarriageReturn", e[e.Space = 32] = "Space", e[e.ExclamationMark = 33] = "ExclamationMark", e[e.Number = 35] = "Number", e[e.Amp = 38] = "Amp", e[e.SingleQuote = 39] = "SingleQuote", e[e.DoubleQuote = 34] = "DoubleQuote", e[e.Dash = 45] = "Dash", e[e.Slash = 47] = "Slash", e[e.Zero = 48] = "Zero", e[e.Nine = 57] = "Nine", e[e.Semi = 59] = "Semi", e[e.Lt = 60] = "Lt", e[e.Eq = 61] = "Eq", e[e.Gt = 62] = "Gt", e[e.Questionmark = 63] = "Questionmark", e[e.UpperA = 65] = "UpperA", e[e.LowerA = 97] = "LowerA", e[e.UpperF = 70] = "UpperF", e[e.LowerF = 102] = "LowerF", e[e.UpperZ = 90] = "UpperZ", e[e.LowerZ = 122] = "LowerZ", e[e.LowerX = 120] = "LowerX", e[e.OpeningSquareBracket = 91] = "OpeningSquareBracket";
})(N || (N = {}));
var g;
(function(e) {
  e[e.Text = 1] = "Text", e[e.BeforeTagName = 2] = "BeforeTagName", e[e.InTagName = 3] = "InTagName", e[e.InSelfClosingTag = 4] = "InSelfClosingTag", e[e.BeforeClosingTagName = 5] = "BeforeClosingTagName", e[e.InClosingTagName = 6] = "InClosingTagName", e[e.AfterClosingTagName = 7] = "AfterClosingTagName", e[e.BeforeAttributeName = 8] = "BeforeAttributeName", e[e.InAttributeName = 9] = "InAttributeName", e[e.AfterAttributeName = 10] = "AfterAttributeName", e[e.BeforeAttributeValue = 11] = "BeforeAttributeValue", e[e.InAttributeValueDq = 12] = "InAttributeValueDq", e[e.InAttributeValueSq = 13] = "InAttributeValueSq", e[e.InAttributeValueNq = 14] = "InAttributeValueNq", e[e.BeforeDeclaration = 15] = "BeforeDeclaration", e[e.InDeclaration = 16] = "InDeclaration", e[e.InProcessingInstruction = 17] = "InProcessingInstruction", e[e.BeforeComment = 18] = "BeforeComment", e[e.CDATASequence = 19] = "CDATASequence", e[e.InSpecialComment = 20] = "InSpecialComment", e[e.InCommentLike = 21] = "InCommentLike", e[e.BeforeSpecialS = 22] = "BeforeSpecialS", e[e.BeforeSpecialT = 23] = "BeforeSpecialT", e[e.SpecialStartSequence = 24] = "SpecialStartSequence", e[e.InSpecialTag = 25] = "InSpecialTag", e[e.InEntity = 26] = "InEntity";
})(g || (g = {}));
function de(e) {
  return e === N.Space || e === N.NewLine || e === N.Tab || e === N.FormFeed || e === N.CarriageReturn;
}
function Kt(e) {
  return e === N.Slash || e === N.Gt || de(e);
}
function ia(e) {
  return e >= N.LowerA && e <= N.LowerZ || e >= N.UpperA && e <= N.UpperZ;
}
var ue;
(function(e) {
  e[e.NoValue = 0] = "NoValue", e[e.Unquoted = 1] = "Unquoted", e[e.Single = 2] = "Single", e[e.Double = 3] = "Double";
})(ue || (ue = {}));
var w = {
  Cdata: new Uint8Array([67, 68, 65, 84, 65, 91]),
  CdataEnd: new Uint8Array([93, 93, 62]),
  CommentEnd: new Uint8Array([45, 45, 62]),
  ScriptEnd: new Uint8Array([60, 47, 115, 99, 114, 105, 112, 116]),
  StyleEnd: new Uint8Array([60, 47, 115, 116, 121, 108, 101]),
  TitleEnd: new Uint8Array([60, 47, 116, 105, 116, 108, 101]),
  TextareaEnd: new Uint8Array([
    60,
    47,
    116,
    101,
    120,
    116,
    97,
    114,
    101,
    97
  ]),
  XmpEnd: new Uint8Array([60, 47, 120, 109, 112])
};

class Wt {
  constructor({ xmlMode: e = !1, decodeEntities: t = !0 }, u) {
    this.cbs = u, this.state = g.Text, this.buffer = "", this.sectionStart = 0, this.index = 0, this.entityStart = 0, this.baseState = g.Text, this.isSpecial = !1, this.running = !0, this.offset = 0, this.currentSequence = void 0, this.sequenceIndex = 0, this.xmlMode = e, this.decodeEntities = t, this.entityDecoder = new Uu(e ? Pu : ku, (s, i) => this.emitCodePoint(s, i));
  }
  reset() {
    this.state = g.Text, this.buffer = "", this.sectionStart = 0, this.index = 0, this.baseState = g.Text, this.currentSequence = void 0, this.running = !0, this.offset = 0;
  }
  write(e) {
    this.offset += this.buffer.length, this.buffer = e, this.parse();
  }
  end() {
    if (this.running)
      this.finish();
  }
  pause() {
    this.running = !1;
  }
  resume() {
    if (this.running = !0, this.index < this.buffer.length + this.offset)
      this.parse();
  }
  stateText(e) {
    if (e === N.Lt || !this.decodeEntities && this.fastForwardTo(N.Lt)) {
      if (this.index > this.sectionStart)
        this.cbs.ontext(this.sectionStart, this.index);
      this.state = g.BeforeTagName, this.sectionStart = this.index;
    } else if (this.decodeEntities && e === N.Amp)
      this.startEntity();
  }
  stateSpecialStartSequence(e) {
    let t = this.sequenceIndex === this.currentSequence.length;
    if (!(t ? Kt(e) : (e | 32) === this.currentSequence[this.sequenceIndex]))
      this.isSpecial = !1;
    else if (!t) {
      this.sequenceIndex++;
      return;
    }
    this.sequenceIndex = 0, this.state = g.InTagName, this.stateInTagName(e);
  }
  stateInSpecialTag(e) {
    if (this.sequenceIndex === this.currentSequence.length) {
      if (e === N.Gt || de(e)) {
        let t = this.index - this.currentSequence.length;
        if (this.sectionStart < t) {
          let u = this.index;
          this.index = t, this.cbs.ontext(this.sectionStart, t), this.index = u;
        }
        this.isSpecial = !1, this.sectionStart = t + 2, this.stateInClosingTagName(e);
        return;
      }
      this.sequenceIndex = 0;
    }
    if ((e | 32) === this.currentSequence[this.sequenceIndex])
      this.sequenceIndex += 1;
    else if (this.sequenceIndex === 0) {
      if (this.currentSequence === w.TitleEnd) {
        if (this.decodeEntities && e === N.Amp)
          this.startEntity();
      } else if (this.fastForwardTo(N.Lt))
        this.sequenceIndex = 1;
    } else
      this.sequenceIndex = Number(e === N.Lt);
  }
  stateCDATASequence(e) {
    if (e === w.Cdata[this.sequenceIndex]) {
      if (++this.sequenceIndex === w.Cdata.length)
        this.state = g.InCommentLike, this.currentSequence = w.CdataEnd, this.sequenceIndex = 0, this.sectionStart = this.index + 1;
    } else
      this.sequenceIndex = 0, this.state = g.InDeclaration, this.stateInDeclaration(e);
  }
  fastForwardTo(e) {
    while (++this.index < this.buffer.length + this.offset)
      if (this.buffer.charCodeAt(this.index - this.offset) === e)
        return !0;
    return this.index = this.buffer.length + this.offset - 1, !1;
  }
  stateInCommentLike(e) {
    if (e === this.currentSequence[this.sequenceIndex]) {
      if (++this.sequenceIndex === this.currentSequence.length) {
        if (this.currentSequence === w.CdataEnd)
          this.cbs.oncdata(this.sectionStart, this.index, 2);
        else
          this.cbs.oncomment(this.sectionStart, this.index, 2);
        this.sequenceIndex = 0, this.sectionStart = this.index + 1, this.state = g.Text;
      }
    } else if (this.sequenceIndex === 0) {
      if (this.fastForwardTo(this.currentSequence[0]))
        this.sequenceIndex = 1;
    } else if (e !== this.currentSequence[this.sequenceIndex - 1])
      this.sequenceIndex = 0;
  }
  isTagStartChar(e) {
    return this.xmlMode ? !Kt(e) : ia(e);
  }
  startSpecial(e, t) {
    this.isSpecial = !0, this.currentSequence = e, this.sequenceIndex = t, this.state = g.SpecialStartSequence;
  }
  stateBeforeTagName(e) {
    if (e === N.ExclamationMark)
      this.state = g.BeforeDeclaration, this.sectionStart = this.index + 1;
    else if (e === N.Questionmark)
      this.state = g.InProcessingInstruction, this.sectionStart = this.index + 1;
    else if (this.isTagStartChar(e)) {
      let t = e | 32;
      if (this.sectionStart = this.index, this.xmlMode)
        this.state = g.InTagName;
      else if (t === w.ScriptEnd[2])
        this.state = g.BeforeSpecialS;
      else if (t === w.TitleEnd[2] || t === w.XmpEnd[2])
        this.state = g.BeforeSpecialT;
      else
        this.state = g.InTagName;
    } else if (e === N.Slash)
      this.state = g.BeforeClosingTagName;
    else
      this.state = g.Text, this.stateText(e);
  }
  stateInTagName(e) {
    if (Kt(e))
      this.cbs.onopentagname(this.sectionStart, this.index), this.sectionStart = -1, this.state = g.BeforeAttributeName, this.stateBeforeAttributeName(e);
  }
  stateBeforeClosingTagName(e) {
    if (de(e))
      ;
    else if (e === N.Gt)
      this.state = g.Text;
    else
      this.state = this.isTagStartChar(e) ? g.InClosingTagName : g.InSpecialComment, this.sectionStart = this.index;
  }
  stateInClosingTagName(e) {
    if (e === N.Gt || de(e))
      this.cbs.onclosetag(this.sectionStart, this.index), this.sectionStart = -1, this.state = g.AfterClosingTagName, this.stateAfterClosingTagName(e);
  }
  stateAfterClosingTagName(e) {
    if (e === N.Gt || this.fastForwardTo(N.Gt))
      this.state = g.Text, this.sectionStart = this.index + 1;
  }
  stateBeforeAttributeName(e) {
    if (e === N.Gt) {
      if (this.cbs.onopentagend(this.index), this.isSpecial)
        this.state = g.InSpecialTag, this.sequenceIndex = 0;
      else
        this.state = g.Text;
      this.sectionStart = this.index + 1;
    } else if (e === N.Slash)
      this.state = g.InSelfClosingTag;
    else if (!de(e))
      this.state = g.InAttributeName, this.sectionStart = this.index;
  }
  stateInSelfClosingTag(e) {
    if (e === N.Gt)
      this.cbs.onselfclosingtag(this.index), this.state = g.Text, this.sectionStart = this.index + 1, this.isSpecial = !1;
    else if (!de(e))
      this.state = g.BeforeAttributeName, this.stateBeforeAttributeName(e);
  }
  stateInAttributeName(e) {
    if (e === N.Eq || Kt(e))
      this.cbs.onattribname(this.sectionStart, this.index), this.sectionStart = this.index, this.state = g.AfterAttributeName, this.stateAfterAttributeName(e);
  }
  stateAfterAttributeName(e) {
    if (e === N.Eq)
      this.state = g.BeforeAttributeValue;
    else if (e === N.Slash || e === N.Gt)
      this.cbs.onattribend(ue.NoValue, this.sectionStart), this.sectionStart = -1, this.state = g.BeforeAttributeName, this.stateBeforeAttributeName(e);
    else if (!de(e))
      this.cbs.onattribend(ue.NoValue, this.sectionStart), this.state = g.InAttributeName, this.sectionStart = this.index;
  }
  stateBeforeAttributeValue(e) {
    if (e === N.DoubleQuote)
      this.state = g.InAttributeValueDq, this.sectionStart = this.index + 1;
    else if (e === N.SingleQuote)
      this.state = g.InAttributeValueSq, this.sectionStart = this.index + 1;
    else if (!de(e))
      this.sectionStart = this.index, this.state = g.InAttributeValueNq, this.stateInAttributeValueNoQuotes(e);
  }
  handleInAttributeValue(e, t) {
    if (e === t || !this.decodeEntities && this.fastForwardTo(t))
      this.cbs.onattribdata(this.sectionStart, this.index), this.sectionStart = -1, this.cbs.onattribend(t === N.DoubleQuote ? ue.Double : ue.Single, this.index + 1), this.state = g.BeforeAttributeName;
    else if (this.decodeEntities && e === N.Amp)
      this.startEntity();
  }
  stateInAttributeValueDoubleQuotes(e) {
    this.handleInAttributeValue(e, N.DoubleQuote);
  }
  stateInAttributeValueSingleQuotes(e) {
    this.handleInAttributeValue(e, N.SingleQuote);
  }
  stateInAttributeValueNoQuotes(e) {
    if (de(e) || e === N.Gt)
      this.cbs.onattribdata(this.sectionStart, this.index), this.sectionStart = -1, this.cbs.onattribend(ue.Unquoted, this.index), this.state = g.BeforeAttributeName, this.stateBeforeAttributeName(e);
    else if (this.decodeEntities && e === N.Amp)
      this.startEntity();
  }
  stateBeforeDeclaration(e) {
    if (e === N.OpeningSquareBracket)
      this.state = g.CDATASequence, this.sequenceIndex = 0;
    else
      this.state = e === N.Dash ? g.BeforeComment : g.InDeclaration;
  }
  stateInDeclaration(e) {
    if (e === N.Gt || this.fastForwardTo(N.Gt))
      this.cbs.ondeclaration(this.sectionStart, this.index), this.state = g.Text, this.sectionStart = this.index + 1;
  }
  stateInProcessingInstruction(e) {
    if (e === N.Gt || this.fastForwardTo(N.Gt))
      this.cbs.onprocessinginstruction(this.sectionStart, this.index), this.state = g.Text, this.sectionStart = this.index + 1;
  }
  stateBeforeComment(e) {
    if (e === N.Dash)
      this.state = g.InCommentLike, this.currentSequence = w.CommentEnd, this.sequenceIndex = 2, this.sectionStart = this.index + 1;
    else
      this.state = g.InDeclaration;
  }
  stateInSpecialComment(e) {
    if (e === N.Gt || this.fastForwardTo(N.Gt))
      this.cbs.oncomment(this.sectionStart, this.index, 0), this.state = g.Text, this.sectionStart = this.index + 1;
  }
  stateBeforeSpecialS(e) {
    let t = e | 32;
    if (t === w.ScriptEnd[3])
      this.startSpecial(w.ScriptEnd, 4);
    else if (t === w.StyleEnd[3])
      this.startSpecial(w.StyleEnd, 4);
    else
      this.state = g.InTagName, this.stateInTagName(e);
  }
  stateBeforeSpecialT(e) {
    switch (e | 32) {
      case w.TitleEnd[3]: {
        this.startSpecial(w.TitleEnd, 4);
        break;
      }
      case w.TextareaEnd[3]: {
        this.startSpecial(w.TextareaEnd, 4);
        break;
      }
      case w.XmpEnd[3]: {
        this.startSpecial(w.XmpEnd, 4);
        break;
      }
      default:
        this.state = g.InTagName, this.stateInTagName(e);
    }
  }
  startEntity() {
    this.baseState = this.state, this.state = g.InEntity, this.entityStart = this.index, this.entityDecoder.startEntity(this.xmlMode ? te.Strict : this.baseState === g.Text || this.baseState === g.InSpecialTag ? te.Legacy : te.Attribute);
  }
  stateInEntity() {
    let e = this.index - this.offset, t = this.entityDecoder.write(this.buffer, e);
    if (t >= 0) {
      if (this.state = this.baseState, t === 0)
        this.index -= 1;
    } else {
      if (e < this.buffer.length && this.buffer.charCodeAt(e) === N.Amp) {
        this.state = this.baseState, this.index -= 1;
        return;
      }
      this.index = this.offset + this.buffer.length - 1;
    }
  }
  cleanup() {
    if (this.running && this.sectionStart !== this.index) {
      if (this.state === g.Text || this.state === g.InSpecialTag && this.sequenceIndex === 0)
        this.cbs.ontext(this.sectionStart, this.index), this.sectionStart = this.index;
      else if (this.state === g.InAttributeValueDq || this.state === g.InAttributeValueSq || this.state === g.InAttributeValueNq)
        this.cbs.onattribdata(this.sectionStart, this.index), this.sectionStart = this.index;
    }
  }
  shouldContinue() {
    return this.index < this.buffer.length + this.offset && this.running;
  }
  parse() {
    while (this.shouldContinue()) {
      let e = this.buffer.charCodeAt(this.index - this.offset);
      switch (this.state) {
        case g.Text: {
          this.stateText(e);
          break;
        }
        case g.SpecialStartSequence: {
          this.stateSpecialStartSequence(e);
          break;
        }
        case g.InSpecialTag: {
          this.stateInSpecialTag(e);
          break;
        }
        case g.CDATASequence: {
          this.stateCDATASequence(e);
          break;
        }
        case g.InAttributeValueDq: {
          this.stateInAttributeValueDoubleQuotes(e);
          break;
        }
        case g.InAttributeName: {
          this.stateInAttributeName(e);
          break;
        }
        case g.InCommentLike: {
          this.stateInCommentLike(e);
          break;
        }
        case g.InSpecialComment: {
          this.stateInSpecialComment(e);
          break;
        }
        case g.BeforeAttributeName: {
          this.stateBeforeAttributeName(e);
          break;
        }
        case g.InTagName: {
          this.stateInTagName(e);
          break;
        }
        case g.InClosingTagName: {
          this.stateInClosingTagName(e);
          break;
        }
        case g.BeforeTagName: {
          this.stateBeforeTagName(e);
          break;
        }
        case g.AfterAttributeName: {
          this.stateAfterAttributeName(e);
          break;
        }
        case g.InAttributeValueSq: {
          this.stateInAttributeValueSingleQuotes(e);
          break;
        }
        case g.BeforeAttributeValue: {
          this.stateBeforeAttributeValue(e);
          break;
        }
        case g.BeforeClosingTagName: {
          this.stateBeforeClosingTagName(e);
          break;
        }
        case g.AfterClosingTagName: {
          this.stateAfterClosingTagName(e);
          break;
        }
        case g.BeforeSpecialS: {
          this.stateBeforeSpecialS(e);
          break;
        }
        case g.BeforeSpecialT: {
          this.stateBeforeSpecialT(e);
          break;
        }
        case g.InAttributeValueNq: {
          this.stateInAttributeValueNoQuotes(e);
          break;
        }
        case g.InSelfClosingTag: {
          this.stateInSelfClosingTag(e);
          break;
        }
        case g.InDeclaration: {
          this.stateInDeclaration(e);
          break;
        }
        case g.BeforeDeclaration: {
          this.stateBeforeDeclaration(e);
          break;
        }
        case g.BeforeComment: {
          this.stateBeforeComment(e);
          break;
        }
        case g.InProcessingInstruction: {
          this.stateInProcessingInstruction(e);
          break;
        }
        case g.InEntity: {
          this.stateInEntity();
          break;
        }
      }
      this.index++;
    }
    this.cleanup();
  }
  finish() {
    if (this.state === g.InEntity)
      this.entityDecoder.end(), this.state = this.baseState;
    this.handleTrailingData(), this.cbs.onend();
  }
  handleTrailingData() {
    let e = this.buffer.length + this.offset;
    if (this.sectionStart >= e)
      return;
    if (this.state === g.InCommentLike)
      if (this.currentSequence === w.CdataEnd)
        this.cbs.oncdata(this.sectionStart, e, 0);
      else
        this.cbs.oncomment(this.sectionStart, e, 0);
    else if (this.state === g.InTagName || this.state === g.BeforeAttributeName || this.state === g.BeforeAttributeValue || this.state === g.AfterAttributeName || this.state === g.InAttributeName || this.state === g.InAttributeValueSq || this.state === g.InAttributeValueDq || this.state === g.InAttributeValueNq || this.state === g.InClosingTagName)
      ;
    else
      this.cbs.ontext(this.sectionStart, e);
  }
  emitCodePoint(e, t) {
    if (this.baseState !== g.Text && this.baseState !== g.InSpecialTag) {
      if (this.sectionStart < this.entityStart)
        this.cbs.onattribdata(this.sectionStart, this.entityStart);
      this.sectionStart = this.entityStart + t, this.index = this.sectionStart - 1, this.cbs.onattribentity(e);
    } else {
      if (this.sectionStart < this.entityStart)
        this.cbs.ontext(this.sectionStart, this.entityStart);
      this.sectionStart = this.entityStart + t, this.index = this.sectionStart - 1, this.cbs.ontextentity(e, this.sectionStart);
    }
  }
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/htmlparser2/dist/esm/Parser.js
var Je = /* @__PURE__ */ new Set([
  "input",
  "option",
  "optgroup",
  "select",
  "button",
  "datalist",
  "textarea"
]), R = /* @__PURE__ */ new Set(["p"]), Ar = /* @__PURE__ */ new Set(["thead", "tbody"]), or = /* @__PURE__ */ new Set(["dd", "dt"]), dr = /* @__PURE__ */ new Set(["rt", "rp"]), na = /* @__PURE__ */ new Map([
  ["tr", /* @__PURE__ */ new Set(["tr", "th", "td"])],
  ["th", /* @__PURE__ */ new Set(["th"])],
  ["td", /* @__PURE__ */ new Set(["thead", "th", "td"])],
  ["body", /* @__PURE__ */ new Set(["head", "link", "script"])],
  ["li", /* @__PURE__ */ new Set(["li"])],
  ["p", R],
  ["h1", R],
  ["h2", R],
  ["h3", R],
  ["h4", R],
  ["h5", R],
  ["h6", R],
  ["select", Je],
  ["input", Je],
  ["output", Je],
  ["button", Je],
  ["datalist", Je],
  ["textarea", Je],
  ["option", /* @__PURE__ */ new Set(["option"])],
  ["optgroup", /* @__PURE__ */ new Set(["optgroup", "option"])],
  ["dd", or],
  ["dt", or],
  ["address", R],
  ["article", R],
  ["aside", R],
  ["blockquote", R],
  ["details", R],
  ["div", R],
  ["dl", R],
  ["fieldset", R],
  ["figcaption", R],
  ["figure", R],
  ["footer", R],
  ["form", R],
  ["header", R],
  ["hr", R],
  ["main", R],
  ["nav", R],
  ["ol", R],
  ["pre", R],
  ["section", R],
  ["table", R],
  ["ul", R],
  ["rt", dr],
  ["rp", dr],
  ["tbody", Ar],
  ["tfoot", Ar]
]), aa = /* @__PURE__ */ new Set([
  "area",
  "base",
  "basefont",
  "br",
  "col",
  "command",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "isindex",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]), lr = /* @__PURE__ */ new Set(["math", "svg"]), hr = /* @__PURE__ */ new Set([
  "mi",
  "mo",
  "mn",
  "ms",
  "mtext",
  "annotation-xml",
  "foreignobject",
  "desc",
  "title"
]), ca = /\s|\//;

class Qu {
  constructor(e, t = {}) {
    var u, s, i, n, a, d;
    this.options = t, this.startIndex = 0, this.endIndex = 0, this.openTagStart = 0, this.tagname = "", this.attribname = "", this.attribvalue = "", this.attribs = null, this.stack = [], this.buffers = [], this.bufferOffset = 0, this.writeIndex = 0, this.ended = !1, this.cbs = e !== null && e !== void 0 ? e : {}, this.htmlMode = !this.options.xmlMode, this.lowerCaseTagNames = (u = t.lowerCaseTags) !== null && u !== void 0 ? u : this.htmlMode, this.lowerCaseAttributeNames = (s = t.lowerCaseAttributeNames) !== null && s !== void 0 ? s : this.htmlMode, this.recognizeSelfClosing = (i = t.recognizeSelfClosing) !== null && i !== void 0 ? i : !this.htmlMode, this.tokenizer = new ((n = t.Tokenizer) !== null && n !== void 0 ? n : Wt)(this.options, this), this.foreignContext = [!this.htmlMode], (d = (a = this.cbs).onparserinit) === null || d === void 0 || d.call(a, this);
  }
  ontext(e, t) {
    var u, s;
    let i = this.getSlice(e, t);
    this.endIndex = t - 1, (s = (u = this.cbs).ontext) === null || s === void 0 || s.call(u, i), this.startIndex = t;
  }
  ontextentity(e, t) {
    var u, s;
    this.endIndex = t - 1, (s = (u = this.cbs).ontext) === null || s === void 0 || s.call(u, it(e)), this.startIndex = t;
  }
  isVoidElement(e) {
    return this.htmlMode && aa.has(e);
  }
  onopentagname(e, t) {
    this.endIndex = t;
    let u = this.getSlice(e, t);
    if (this.lowerCaseTagNames)
      u = u.toLowerCase();
    this.emitOpenTag(u);
  }
  emitOpenTag(e) {
    var t, u, s, i;
    this.openTagStart = this.startIndex, this.tagname = e;
    let n = this.htmlMode && na.get(e);
    if (n)
      while (this.stack.length > 0 && n.has(this.stack[0])) {
        let a = this.stack.shift();
        (u = (t = this.cbs).onclosetag) === null || u === void 0 || u.call(t, a, !0);
      }
    if (!this.isVoidElement(e)) {
      if (this.stack.unshift(e), this.htmlMode) {
        if (lr.has(e))
          this.foreignContext.unshift(!0);
        else if (hr.has(e))
          this.foreignContext.unshift(!1);
      }
    }
    if ((i = (s = this.cbs).onopentagname) === null || i === void 0 || i.call(s, e), this.cbs.onopentag)
      this.attribs = {};
  }
  endOpenTag(e) {
    var t, u;
    if (this.startIndex = this.openTagStart, this.attribs)
      (u = (t = this.cbs).onopentag) === null || u === void 0 || u.call(t, this.tagname, this.attribs, e), this.attribs = null;
    if (this.cbs.onclosetag && this.isVoidElement(this.tagname))
      this.cbs.onclosetag(this.tagname, !0);
    this.tagname = "";
  }
  onopentagend(e) {
    this.endIndex = e, this.endOpenTag(!1), this.startIndex = e + 1;
  }
  onclosetag(e, t) {
    var u, s, i, n, a, d, l, f;
    this.endIndex = t;
    let T = this.getSlice(e, t);
    if (this.lowerCaseTagNames)
      T = T.toLowerCase();
    if (this.htmlMode && (lr.has(T) || hr.has(T)))
      this.foreignContext.shift();
    if (!this.isVoidElement(T)) {
      let C = this.stack.indexOf(T);
      if (C !== -1)
        for (let I = 0;I <= C; I++) {
          let S = this.stack.shift();
          (s = (u = this.cbs).onclosetag) === null || s === void 0 || s.call(u, S, I !== C);
        }
      else if (this.htmlMode && T === "p")
        this.emitOpenTag("p"), this.closeCurrentTag(!0);
    } else if (this.htmlMode && T === "br")
      (n = (i = this.cbs).onopentagname) === null || n === void 0 || n.call(i, "br"), (d = (a = this.cbs).onopentag) === null || d === void 0 || d.call(a, "br", {}, !0), (f = (l = this.cbs).onclosetag) === null || f === void 0 || f.call(l, "br", !1);
    this.startIndex = t + 1;
  }
  onselfclosingtag(e) {
    if (this.endIndex = e, this.recognizeSelfClosing || this.foreignContext[0])
      this.closeCurrentTag(!1), this.startIndex = e + 1;
    else
      this.onopentagend(e);
  }
  closeCurrentTag(e) {
    var t, u;
    let s = this.tagname;
    if (this.endOpenTag(e), this.stack[0] === s)
      (u = (t = this.cbs).onclosetag) === null || u === void 0 || u.call(t, s, !e), this.stack.shift();
  }
  onattribname(e, t) {
    this.startIndex = e;
    let u = this.getSlice(e, t);
    this.attribname = this.lowerCaseAttributeNames ? u.toLowerCase() : u;
  }
  onattribdata(e, t) {
    this.attribvalue += this.getSlice(e, t);
  }
  onattribentity(e) {
    this.attribvalue += it(e);
  }
  onattribend(e, t) {
    var u, s;
    if (this.endIndex = t, (s = (u = this.cbs).onattribute) === null || s === void 0 || s.call(u, this.attribname, this.attribvalue, e === ue.Double ? '"' : e === ue.Single ? "'" : e === ue.NoValue ? void 0 : null), this.attribs && !Object.prototype.hasOwnProperty.call(this.attribs, this.attribname))
      this.attribs[this.attribname] = this.attribvalue;
    this.attribvalue = "";
  }
  getInstructionName(e) {
    let t = e.search(ca), u = t < 0 ? e : e.substr(0, t);
    if (this.lowerCaseTagNames)
      u = u.toLowerCase();
    return u;
  }
  ondeclaration(e, t) {
    this.endIndex = t;
    let u = this.getSlice(e, t);
    if (this.cbs.onprocessinginstruction) {
      let s = this.getInstructionName(u);
      this.cbs.onprocessinginstruction(`!${s}`, `!${u}`);
    }
    this.startIndex = t + 1;
  }
  onprocessinginstruction(e, t) {
    this.endIndex = t;
    let u = this.getSlice(e, t);
    if (this.cbs.onprocessinginstruction) {
      let s = this.getInstructionName(u);
      this.cbs.onprocessinginstruction(`?${s}`, `?${u}`);
    }
    this.startIndex = t + 1;
  }
  oncomment(e, t, u) {
    var s, i, n, a;
    this.endIndex = t, (i = (s = this.cbs).oncomment) === null || i === void 0 || i.call(s, this.getSlice(e, t - u)), (a = (n = this.cbs).oncommentend) === null || a === void 0 || a.call(n), this.startIndex = t + 1;
  }
  oncdata(e, t, u) {
    var s, i, n, a, d, l, f, T, C, I;
    this.endIndex = t;
    let S = this.getSlice(e, t - u);
    if (!this.htmlMode || this.options.recognizeCDATA)
      (i = (s = this.cbs).oncdatastart) === null || i === void 0 || i.call(s), (a = (n = this.cbs).ontext) === null || a === void 0 || a.call(n, S), (l = (d = this.cbs).oncdataend) === null || l === void 0 || l.call(d);
    else
      (T = (f = this.cbs).oncomment) === null || T === void 0 || T.call(f, `[CDATA[${S}]]`), (I = (C = this.cbs).oncommentend) === null || I === void 0 || I.call(C);
    this.startIndex = t + 1;
  }
  onend() {
    var e, t;
    if (this.cbs.onclosetag) {
      this.endIndex = this.startIndex;
      for (let u = 0;u < this.stack.length; u++)
        this.cbs.onclosetag(this.stack[u], !0);
    }
    (t = (e = this.cbs).onend) === null || t === void 0 || t.call(e);
  }
  reset() {
    var e, t, u, s;
    (t = (e = this.cbs).onreset) === null || t === void 0 || t.call(e), this.tokenizer.reset(), this.tagname = "", this.attribname = "", this.attribs = null, this.stack.length = 0, this.startIndex = 0, this.endIndex = 0, (s = (u = this.cbs).onparserinit) === null || s === void 0 || s.call(u, this), this.buffers.length = 0, this.foreignContext.length = 0, this.foreignContext.unshift(!this.htmlMode), this.bufferOffset = 0, this.writeIndex = 0, this.ended = !1;
  }
  parseComplete(e) {
    this.reset(), this.end(e);
  }
  getSlice(e, t) {
    while (e - this.bufferOffset >= this.buffers[0].length)
      this.shiftBuffer();
    let u = this.buffers[0].slice(e - this.bufferOffset, t - this.bufferOffset);
    while (t - this.bufferOffset > this.buffers[0].length)
      this.shiftBuffer(), u += this.buffers[0].slice(0, t - this.bufferOffset);
    return u;
  }
  shiftBuffer() {
    this.bufferOffset += this.buffers[0].length, this.writeIndex--, this.buffers.shift();
  }
  write(e) {
    var t, u;
    if (this.ended) {
      (u = (t = this.cbs).onerror) === null || u === void 0 || u.call(t, Error(".write() after done!"));
      return;
    }
    if (this.buffers.push(e), this.tokenizer.running)
      this.tokenizer.write(e), this.writeIndex++;
  }
  end(e) {
    var t, u;
    if (this.ended) {
      (u = (t = this.cbs).onerror) === null || u === void 0 || u.call(t, Error(".end() after done!"));
      return;
    }
    if (e)
      this.write(e);
    this.ended = !0, this.tokenizer.end();
  }
  pause() {
    this.tokenizer.pause();
  }
  resume() {
    this.tokenizer.resume();
    while (this.tokenizer.running && this.writeIndex < this.buffers.length)
      this.tokenizer.write(this.buffers[this.writeIndex++]);
    if (this.ended)
      this.tokenizer.end();
  }
  parseChunk(e) {
    this.write(e);
  }
  done(e) {
    this.end(e);
  }
}
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/htmlparser2/dist/esm/index.js
function fr(e, t) {
  let u = new Du(void 0, t);
  return new Qu(u, t).end(e), u.root;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/attributes.js
var Yu, nt = (Yu = Object.hasOwn) !== null && Yu !== void 0 ? Yu : (e, t) => Object.prototype.hasOwnProperty.call(e, t), at = /\s+/, Gu = "data-", Ku = /^(?:autofocus|autoplay|async|checked|controls|defer|disabled|hidden|loop|multiple|open|readonly|required|scoped|selected)$/i, Aa = /^{[^]*}$|^\[[^]*]$/;
function Jt(e, t, u) {
  var s;
  if (!e || !p(e))
    return;
  if ((s = e.attribs) !== null && s !== void 0 || (e.attribs = {}), !t)
    return e.attribs;
  if (nt(e.attribs, t))
    return !u && Ku.test(t) ? t : e.attribs[t];
  if (e.name === "option" && t === "value")
    return Re(e.children);
  if (e.name === "input" && (e.attribs.type === "radio" || e.attribs.type === "checkbox") && t === "value")
    return "on";
  return;
}
function Ze(e, t, u) {
  if (u === null)
    gr(e, t);
  else
    e.attribs[t] = `${u}`;
}
function oa(e, t) {
  if (typeof e === "object" || t !== void 0) {
    if (typeof t === "function") {
      if (typeof e !== "string")
        throw Error("Bad combination of arguments.");
      return L(this, (u, s) => {
        if (p(u))
          Ze(u, e, t.call(u, s, u.attribs[e]));
      });
    }
    return L(this, (u) => {
      if (!p(u))
        return;
      if (typeof e === "object")
        for (let s of Object.keys(e)) {
          let i = e[s];
          Ze(u, s, i);
        }
      else
        Ze(u, e, t);
    });
  }
  return arguments.length > 1 ? this : Jt(this[0], e, this.options.xmlMode);
}
function Er(e, t, u) {
  return t in e ? e[t] : !u && Ku.test(t) ? Jt(e, t, !1) !== void 0 : Jt(e, t, u);
}
function vu(e, t, u, s) {
  if (t in e)
    e[t] = u;
  else
    Ze(e, t, !s && Ku.test(t) ? u ? "" : null : `${u}`);
}
function da(e, t) {
  var u;
  if (typeof e === "string" && t === void 0) {
    let s = this[0];
    if (!s)
      return;
    switch (e) {
      case "style": {
        let i = this.css(), n = Object.keys(i);
        for (let a = 0;a < n.length; a++)
          i[a] = n[a];
        return i.length = n.length, i;
      }
      case "tagName":
      case "nodeName": {
        if (!p(s))
          return;
        return s.name.toUpperCase();
      }
      case "href":
      case "src": {
        if (!p(s))
          return;
        let i = (u = s.attribs) === null || u === void 0 ? void 0 : u[e];
        if (typeof URL < "u" && (e === "href" && (s.tagName === "a" || s.tagName === "link") || e === "src" && (s.tagName === "img" || s.tagName === "iframe" || s.tagName === "audio" || s.tagName === "video" || s.tagName === "source")) && i !== void 0 && this.options.baseURI)
          return new URL(i, this.options.baseURI).href;
        return i;
      }
      case "innerText":
        return st(s);
      case "textContent":
        return Ae(s);
      case "outerHTML": {
        if (s.type === Bt)
          return this.html();
        return this.clone().wrap("<container />").parent().html();
      }
      case "innerHTML":
        return this.html();
      default: {
        if (!p(s))
          return;
        return Er(s, e, this.options.xmlMode);
      }
    }
  }
  if (typeof e === "object" || t !== void 0) {
    if (typeof t === "function") {
      if (typeof e === "object")
        throw TypeError("Bad combination of arguments.");
      return L(this, (s, i) => {
        if (p(s))
          vu(s, e, t.call(s, i, Er(s, e, this.options.xmlMode)), this.options.xmlMode);
      });
    }
    return L(this, (s) => {
      if (!p(s))
        return;
      if (typeof e === "object")
        for (let i of Object.keys(e)) {
          let n = e[i];
          vu(s, i, n, this.options.xmlMode);
        }
      else
        vu(s, e, t, this.options.xmlMode);
    });
  }
  return;
}
function mr(e, t, u) {
  var s;
  if ((s = e.data) !== null && s !== void 0 || (e.data = {}), typeof t === "object")
    Object.assign(e.data, t);
  else if (typeof t === "string" && u !== void 0)
    e.data[t] = u;
}
function la(e) {
  for (let t of Object.keys(e.attribs)) {
    if (!t.startsWith(Gu))
      continue;
    let u = nr(t.slice(Gu.length));
    if (!nt(e.data, u))
      e.data[u] = Tr(e.attribs[t]);
  }
  return e.data;
}
function ha(e, t) {
  let u = Gu + ar(t), s = e.data;
  if (nt(s, t))
    return s[t];
  if (nt(e.attribs, u))
    return s[t] = Tr(e.attribs[u]);
  return;
}
function Tr(e) {
  if (e === "null")
    return null;
  if (e === "true")
    return !0;
  if (e === "false")
    return !1;
  let t = Number(e);
  if (e === String(t))
    return t;
  if (Aa.test(e))
    try {
      return JSON.parse(e);
    } catch {}
  return e;
}
function fa(e, t) {
  var u;
  let s = this[0];
  if (!s || !p(s))
    return;
  let i = s;
  if ((u = i.data) !== null && u !== void 0 || (i.data = {}), e == null)
    return la(i);
  if (typeof e === "object" || t !== void 0)
    return L(this, (n) => {
      if (p(n))
        if (typeof e === "object")
          mr(n, e);
        else
          mr(n, e, t);
    }), this;
  return ha(i, e);
}
function Ea(e) {
  let t = arguments.length === 0, u = this[0];
  if (!u || !p(u))
    return t ? void 0 : this;
  switch (u.name) {
    case "textarea":
      return this.text(e);
    case "select": {
      let s = this.find("option:selected");
      if (!t) {
        if (this.attr("multiple") == null && typeof e === "object")
          return this;
        this.find("option").removeAttr("selected");
        let i = typeof e === "object" ? e : [e];
        for (let n of i)
          this.find(`option[value="${n}"]`).attr("selected", "");
        return this;
      }
      return this.attr("multiple") ? s.toArray().map((i) => Re(i.children)) : s.attr("value");
    }
    case "button":
    case "input":
    case "option":
      return t ? this.attr("value") : this.attr("value", e);
  }
  return;
}
function gr(e, t) {
  if (!e.attribs || !nt(e.attribs, t))
    return;
  delete e.attribs[t];
}
function Zt(e) {
  return e ? e.trim().split(at) : [];
}
function ma(e) {
  let t = Zt(e);
  for (let u of t)
    L(this, (s) => {
      if (p(s))
        gr(s, u);
    });
  return this;
}
function Ta(e) {
  return this.toArray().some((t) => {
    let u = p(t) && t.attribs.class, s = -1;
    if (u && e.length > 0)
      while ((s = u.indexOf(e, s + 1)) > -1) {
        let i = s + e.length;
        if ((s === 0 || at.test(u[s - 1])) && (i === u.length || at.test(u[i])))
          return !0;
      }
    return !1;
  });
}
function br(e) {
  if (typeof e === "function")
    return L(this, (s, i) => {
      if (p(s)) {
        let n = s.attribs.class || "";
        br.call([s], e.call(s, i, n));
      }
    });
  if (!e || typeof e !== "string")
    return this;
  let t = e.split(at), u = this.length;
  for (let s = 0;s < u; s++) {
    let i = this[s];
    if (!p(i))
      continue;
    let n = Jt(i, "class", !1);
    if (n) {
      let a = ` ${n} `;
      for (let d of t) {
        let l = `${d} `;
        if (!a.includes(` ${l}`))
          a += l;
      }
      Ze(i, "class", a.trim());
    } else
      Ze(i, "class", t.join(" ").trim());
  }
  return this;
}
function pr(e) {
  if (typeof e === "function")
    return L(this, (i, n) => {
      if (p(i))
        pr.call([i], e.call(i, n, i.attribs.class || ""));
    });
  let t = Zt(e), u = t.length, s = arguments.length === 0;
  return L(this, (i) => {
    if (!p(i))
      return;
    if (s)
      i.attribs.class = "";
    else {
      let n = Zt(i.attribs.class), a = !1;
      for (let d = 0;d < u; d++) {
        let l = n.indexOf(t[d]);
        if (l !== -1)
          n.splice(l, 1), a = !0, d--;
      }
      if (a)
        i.attribs.class = n.join(" ");
    }
  });
}
function Ir(e, t) {
  if (typeof e === "function")
    return L(this, (a, d) => {
      if (p(a))
        Ir.call([a], e.call(a, d, a.attribs.class || "", t), t);
    });
  if (!e || typeof e !== "string")
    return this;
  let u = e.split(at), s = u.length, i = typeof t === "boolean" ? t ? 1 : -1 : 0, n = this.length;
  for (let a = 0;a < n; a++) {
    let d = this[a];
    if (!p(d))
      continue;
    let l = Zt(d.attribs.class);
    for (let f = 0;f < s; f++) {
      let T = l.indexOf(u[f]);
      if (i >= 0 && T === -1)
        l.push(u[f]);
      else if (i <= 0 && T !== -1)
        l.splice(T, 1);
    }
    d.attribs.class = l.join(" ");
  }
  return this;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-what/lib/es/types.js
var _;
(function(e) {
  e.Attribute = "attribute", e.Pseudo = "pseudo", e.PseudoElement = "pseudo-element", e.Tag = "tag", e.Universal = "universal", e.Adjacent = "adjacent", e.Child = "child", e.Descendant = "descendant", e.Parent = "parent", e.Sibling = "sibling", e.ColumnCombinator = "column-combinator";
})(_ || (_ = {}));
var M;
(function(e) {
  e.Any = "any", e.Element = "element", e.End = "end", e.Equals = "equals", e.Exists = "exists", e.Hyphen = "hyphen", e.Not = "not", e.Start = "start";
})(M || (M = {}));
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-what/lib/es/parse.js
var Cr = /^[^\\#]?(?:\\(?:[\da-f]{1,6}\s?|.)|[\w\-\u00b0-\uFFFF])+/, ga = /\\([\da-f]{1,6}\s?|(\s)|.)/gi, ba = /* @__PURE__ */ new Map([
  [126, M.Element],
  [94, M.Start],
  [36, M.End],
  [42, M.Any],
  [33, M.Not],
  [124, M.Hyphen]
]), pa = /* @__PURE__ */ new Set([
  "has",
  "not",
  "matches",
  "is",
  "where",
  "host",
  "host-context"
]);
function ye(e) {
  switch (e.type) {
    case _.Adjacent:
    case _.Child:
    case _.Descendant:
    case _.Parent:
    case _.Sibling:
    case _.ColumnCombinator:
      return !0;
    default:
      return !1;
  }
}
var Ia = /* @__PURE__ */ new Set(["contains", "icontains"]);
function Ca(e, t, u) {
  let s = parseInt(t, 16) - 65536;
  return s !== s || u ? t : s < 0 ? String.fromCharCode(s + 65536) : String.fromCharCode(s >> 10 | 55296, s & 1023 | 56320);
}
function ct(e) {
  return e.replace(ga, Ca);
}
function Ju(e) {
  return e === 39 || e === 34;
}
function _r(e) {
  return e === 32 || e === 9 || e === 10 || e === 12 || e === 13;
}
function le(e) {
  let t = [], u = Nr(t, `${e}`, 0);
  if (u < e.length)
    throw Error(`Unmatched selector: ${e.slice(u)}`);
  return t;
}
function Nr(e, t, u) {
  let s = [];
  function i(I) {
    let S = t.slice(u + I).match(Cr);
    if (!S)
      throw Error(`Expected name, found ${t.slice(u)}`);
    let [D] = S;
    return u += I + D.length, ct(D);
  }
  function n(I) {
    u += I;
    while (u < t.length && _r(t.charCodeAt(u)))
      u++;
  }
  function a() {
    u += 1;
    let I = u, S = 1;
    for (;S > 0 && u < t.length; u++)
      if (t.charCodeAt(u) === 40 && !d(u))
        S++;
      else if (t.charCodeAt(u) === 41 && !d(u))
        S--;
    if (S)
      throw Error("Parenthesis not matched");
    return ct(t.slice(I, u - 1));
  }
  function d(I) {
    let S = 0;
    while (t.charCodeAt(--I) === 92)
      S++;
    return (S & 1) === 1;
  }
  function l() {
    if (s.length > 0 && ye(s[s.length - 1]))
      throw Error("Did not expect successive traversals.");
  }
  function f(I) {
    if (s.length > 0 && s[s.length - 1].type === _.Descendant) {
      s[s.length - 1].type = I;
      return;
    }
    l(), s.push({ type: I });
  }
  function T(I, S) {
    s.push({
      type: _.Attribute,
      name: I,
      action: S,
      value: i(1),
      namespace: null,
      ignoreCase: "quirks"
    });
  }
  function C() {
    if (s.length && s[s.length - 1].type === _.Descendant)
      s.pop();
    if (s.length === 0)
      throw Error("Empty sub-selector");
    e.push(s);
  }
  if (n(0), t.length === u)
    return u;
  e:
    while (u < t.length) {
      let I = t.charCodeAt(u);
      switch (I) {
        case 32:
        case 9:
        case 10:
        case 12:
        case 13: {
          if (s.length === 0 || s[0].type !== _.Descendant)
            l(), s.push({ type: _.Descendant });
          n(1);
          break;
        }
        case 62: {
          f(_.Child), n(1);
          break;
        }
        case 60: {
          f(_.Parent), n(1);
          break;
        }
        case 126: {
          f(_.Sibling), n(1);
          break;
        }
        case 43: {
          f(_.Adjacent), n(1);
          break;
        }
        case 46: {
          T("class", M.Element);
          break;
        }
        case 35: {
          T("id", M.Equals);
          break;
        }
        case 91: {
          n(1);
          let S, D = null;
          if (t.charCodeAt(u) === 124)
            S = i(1);
          else if (t.startsWith("*|", u))
            D = "*", S = i(2);
          else if (S = i(0), t.charCodeAt(u) === 124 && t.charCodeAt(u + 1) !== 61)
            D = S, S = i(1);
          n(0);
          let k = M.Exists, ee = ba.get(t.charCodeAt(u));
          if (ee) {
            if (k = ee, t.charCodeAt(u + 1) !== 61)
              throw Error("Expected `=`");
            n(2);
          } else if (t.charCodeAt(u) === 61)
            k = M.Equals, n(1);
          let He = "", Ue = null;
          if (k !== "exists") {
            if (Ju(t.charCodeAt(u))) {
              let Dt = t.charCodeAt(u), De = u + 1;
              while (De < t.length && (t.charCodeAt(De) !== Dt || d(De)))
                De += 1;
              if (t.charCodeAt(De) !== Dt)
                throw Error("Attribute value didn't end");
              He = ct(t.slice(u + 1, De)), u = De + 1;
            } else {
              let Dt = u;
              while (u < t.length && (!_r(t.charCodeAt(u)) && t.charCodeAt(u) !== 93 || d(u)))
                u += 1;
              He = ct(t.slice(Dt, u));
            }
            n(0);
            let et = t.charCodeAt(u) | 32;
            if (et === 115)
              Ue = !1, n(1);
            else if (et === 105)
              Ue = !0, n(1);
          }
          if (t.charCodeAt(u) !== 93)
            throw Error("Attribute selector didn't terminate");
          u += 1;
          let $e = {
            type: _.Attribute,
            name: S,
            action: k,
            value: He,
            namespace: D,
            ignoreCase: Ue
          };
          s.push($e);
          break;
        }
        case 58: {
          if (t.charCodeAt(u + 1) === 58) {
            s.push({
              type: _.PseudoElement,
              name: i(2).toLowerCase(),
              data: t.charCodeAt(u) === 40 ? a() : null
            });
            continue;
          }
          let S = i(1).toLowerCase(), D = null;
          if (t.charCodeAt(u) === 40)
            if (pa.has(S)) {
              if (Ju(t.charCodeAt(u + 1)))
                throw Error(`Pseudo-selector ${S} cannot be quoted`);
              if (D = [], u = Nr(D, t, u + 1), t.charCodeAt(u) !== 41)
                throw Error(`Missing closing parenthesis in :${S} (${t})`);
              u += 1;
            } else {
              if (D = a(), Ia.has(S)) {
                let k = D.charCodeAt(0);
                if (k === D.charCodeAt(D.length - 1) && Ju(k))
                  D = D.slice(1, -1);
              }
              D = ct(D);
            }
          s.push({ type: _.Pseudo, name: S, data: D });
          break;
        }
        case 44: {
          C(), s = [], n(1);
          break;
        }
        default: {
          if (t.startsWith("/*", u)) {
            let k = t.indexOf("*/", u + 2);
            if (k < 0)
              throw Error("Comment was not terminated");
            if (u = k + 2, s.length === 0)
              n(0);
            break;
          }
          let S = null, D;
          if (I === 42)
            u += 1, D = "*";
          else if (I === 124) {
            if (D = "", t.charCodeAt(u + 1) === 124) {
              f(_.ColumnCombinator), n(2);
              break;
            }
          } else if (Cr.test(t.slice(u)))
            D = i(0);
          else
            break e;
          if (t.charCodeAt(u) === 124 && t.charCodeAt(u + 1) !== 124)
            if (S = D, t.charCodeAt(u + 1) === 42)
              D = "*", u += 2;
            else
              D = i(1);
          s.push(D === "*" ? { type: _.Universal, namespace: S } : { type: _.Tag, name: D, namespace: S });
        }
      }
    }
  return C(), u;
}
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/index.js
var ss = Be(Ie(), 1);

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/compile.js
var he = Be(Ie(), 1);

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/sort.js
var Dr = /* @__PURE__ */ new Map([
  [_.Universal, 50],
  [_.Tag, 30],
  [_.Attribute, 1],
  [_.Pseudo, 0]
]);
function At(e) {
  return !Dr.has(e.type);
}
var _a = /* @__PURE__ */ new Map([
  [M.Exists, 10],
  [M.Equals, 8],
  [M.Not, 7],
  [M.Start, 6],
  [M.End, 6],
  [M.Any, 5]
]);
function Zu(e) {
  let t = e.map(Br);
  for (let u = 1;u < e.length; u++) {
    let s = t[u];
    if (s < 0)
      continue;
    for (let i = u - 1;i >= 0 && s < t[i]; i--) {
      let n = e[i + 1];
      e[i + 1] = e[i], e[i] = n, t[i + 1] = t[i], t[i] = s;
    }
  }
}
function Br(e) {
  var t, u;
  let s = (t = Dr.get(e.type)) !== null && t !== void 0 ? t : -1;
  if (e.type === _.Attribute) {
    if (s = (u = _a.get(e.action)) !== null && u !== void 0 ? u : 4, e.action === M.Equals && e.name === "id")
      s = 9;
    if (e.ignoreCase)
      s >>= 1;
  } else if (e.type === _.Pseudo)
    if (!e.data)
      s = 3;
    else if (e.name === "has" || e.name === "contains")
      s = 0;
    else if (Array.isArray(e.data)) {
      if (s = Math.min(...e.data.map((i) => Math.min(...i.map(Br)))), s < 0)
        s = 0;
    } else
      s = 2;
  return s;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/attributes.js
var ot = Be(Ie(), 1), Na = /[-[\]{}()*+?.,\\^$|#\s]/g;
function xr(e) {
  return e.replace(Na, "\\$&");
}
var Sa = /* @__PURE__ */ new Set([
  "accept",
  "accept-charset",
  "align",
  "alink",
  "axis",
  "bgcolor",
  "charset",
  "checked",
  "clear",
  "codetype",
  "color",
  "compact",
  "declare",
  "defer",
  "dir",
  "direction",
  "disabled",
  "enctype",
  "face",
  "frame",
  "hreflang",
  "http-equiv",
  "lang",
  "language",
  "link",
  "media",
  "method",
  "multiple",
  "nohref",
  "noresize",
  "noshade",
  "nowrap",
  "readonly",
  "rel",
  "rev",
  "rules",
  "scope",
  "scrolling",
  "selected",
  "shape",
  "target",
  "text",
  "type",
  "valign",
  "valuetype",
  "vlink"
]);
function Fe(e, t) {
  return typeof e.ignoreCase === "boolean" ? e.ignoreCase : e.ignoreCase === "quirks" ? !!t.quirksMode : !t.xmlMode && Sa.has(e.name);
}
var Or = {
  equals(e, t, u) {
    let { adapter: s } = u, { name: i } = t, { value: n } = t;
    if (Fe(t, u))
      return n = n.toLowerCase(), (a) => {
        let d = s.getAttributeValue(a, i);
        return d != null && d.length === n.length && d.toLowerCase() === n && e(a);
      };
    return (a) => s.getAttributeValue(a, i) === n && e(a);
  },
  hyphen(e, t, u) {
    let { adapter: s } = u, { name: i } = t, { value: n } = t, a = n.length;
    if (Fe(t, u))
      return n = n.toLowerCase(), function(l) {
        let f = s.getAttributeValue(l, i);
        return f != null && (f.length === a || f.charAt(a) === "-") && f.substr(0, a).toLowerCase() === n && e(l);
      };
    return function(l) {
      let f = s.getAttributeValue(l, i);
      return f != null && (f.length === a || f.charAt(a) === "-") && f.substr(0, a) === n && e(l);
    };
  },
  element(e, t, u) {
    let { adapter: s } = u, { name: i, value: n } = t;
    if (/\s/.test(n))
      return ot.default.falseFunc;
    let a = new RegExp(`(?:^|\\s)${xr(n)}(?:$|\\s)`, Fe(t, u) ? "i" : "");
    return function(l) {
      let f = s.getAttributeValue(l, i);
      return f != null && f.length >= n.length && a.test(f) && e(l);
    };
  },
  exists(e, { name: t }, { adapter: u }) {
    return (s) => u.hasAttrib(s, t) && e(s);
  },
  start(e, t, u) {
    let { adapter: s } = u, { name: i } = t, { value: n } = t, a = n.length;
    if (a === 0)
      return ot.default.falseFunc;
    if (Fe(t, u))
      return n = n.toLowerCase(), (d) => {
        let l = s.getAttributeValue(d, i);
        return l != null && l.length >= a && l.substr(0, a).toLowerCase() === n && e(d);
      };
    return (d) => {
      var l;
      return !!((l = s.getAttributeValue(d, i)) === null || l === void 0 ? void 0 : l.startsWith(n)) && e(d);
    };
  },
  end(e, t, u) {
    let { adapter: s } = u, { name: i } = t, { value: n } = t, a = -n.length;
    if (a === 0)
      return ot.default.falseFunc;
    if (Fe(t, u))
      return n = n.toLowerCase(), (d) => {
        var l;
        return ((l = s.getAttributeValue(d, i)) === null || l === void 0 ? void 0 : l.substr(a).toLowerCase()) === n && e(d);
      };
    return (d) => {
      var l;
      return !!((l = s.getAttributeValue(d, i)) === null || l === void 0 ? void 0 : l.endsWith(n)) && e(d);
    };
  },
  any(e, t, u) {
    let { adapter: s } = u, { name: i, value: n } = t;
    if (n === "")
      return ot.default.falseFunc;
    if (Fe(t, u)) {
      let a = new RegExp(xr(n), "i");
      return function(l) {
        let f = s.getAttributeValue(l, i);
        return f != null && f.length >= n.length && a.test(f) && e(l);
      };
    }
    return (a) => {
      var d;
      return !!((d = s.getAttributeValue(a, i)) === null || d === void 0 ? void 0 : d.includes(n)) && e(a);
    };
  },
  not(e, t, u) {
    let { adapter: s } = u, { name: i } = t, { value: n } = t;
    if (n === "")
      return (a) => !!s.getAttributeValue(a, i) && e(a);
    else if (Fe(t, u))
      return n = n.toLowerCase(), (a) => {
        let d = s.getAttributeValue(a, i);
        return (d == null || d.length !== n.length || d.toLowerCase() !== n) && e(a);
      };
    return (a) => s.getAttributeValue(a, i) !== n && e(a);
  }
};

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/nth-check/lib/esm/parse.js
var Da = /* @__PURE__ */ new Set([9, 10, 12, 13, 32]);
function Rr(e) {
  if (e = e.trim().toLowerCase(), e === "even")
    return [2, 0];
  else if (e === "odd")
    return [2, 1];
  let t = 0, u = 0, s = n(), i = a();
  if (t < e.length && e.charAt(t) === "n")
    if (t++, u = s * (i !== null && i !== void 0 ? i : 1), d(), t < e.length)
      s = n(), d(), i = a();
    else
      s = i = 0;
  if (i === null || t < e.length)
    throw Error(`n-th rule couldn't be parsed ('${e}')`);
  return [u, s * i];
  function n() {
    if (e.charAt(t) === "-")
      return t++, -1;
    if (e.charAt(t) === "+")
      t++;
    return 1;
  }
  function a() {
    let l = t, f = 0;
    while (t < e.length && e.charCodeAt(t) >= 48 && e.charCodeAt(t) <= 57)
      f = f * 10 + (e.charCodeAt(t) - 48), t++;
    return t === l ? null : f;
  }
  function d() {
    while (t < e.length && Da.has(e.charCodeAt(t)))
      t++;
  }
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/nth-check/lib/esm/compile.js
var Xu = Be(Ie(), 1);
function Lr(e) {
  let t = e[0], u = e[1] - 1;
  if (u < 0 && t <= 0)
    return Xu.default.falseFunc;
  if (t === -1)
    return (n) => n <= u;
  if (t === 0)
    return (n) => n === u;
  if (t === 1)
    return u < 0 ? Xu.default.trueFunc : (n) => n >= u;
  let s = Math.abs(t), i = (u % s + s) % s;
  return t > 1 ? (n) => n >= u && n % s === i : (n) => n <= u && n % s === i;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/nth-check/lib/esm/index.js
function Xe(e) {
  return Lr(Rr(e));
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/pseudo-selectors/filters.js
var Z = Be(Ie(), 1);
function Xt(e, t) {
  return (u) => {
    let s = t.getParent(u);
    return s != null && t.isTag(s) && e(u);
  };
}
var Ve = {
  contains(e, t, { adapter: u }) {
    return function(i) {
      return e(i) && u.getText(i).includes(t);
    };
  },
  icontains(e, t, { adapter: u }) {
    let s = t.toLowerCase();
    return function(n) {
      return e(n) && u.getText(n).toLowerCase().includes(s);
    };
  },
  "nth-child"(e, t, { adapter: u, equals: s }) {
    let i = Xe(t);
    if (i === Z.default.falseFunc)
      return Z.default.falseFunc;
    if (i === Z.default.trueFunc)
      return Xt(e, u);
    return function(a) {
      let d = u.getSiblings(a), l = 0;
      for (let f = 0;f < d.length; f++) {
        if (s(a, d[f]))
          break;
        if (u.isTag(d[f]))
          l++;
      }
      return i(l) && e(a);
    };
  },
  "nth-last-child"(e, t, { adapter: u, equals: s }) {
    let i = Xe(t);
    if (i === Z.default.falseFunc)
      return Z.default.falseFunc;
    if (i === Z.default.trueFunc)
      return Xt(e, u);
    return function(a) {
      let d = u.getSiblings(a), l = 0;
      for (let f = d.length - 1;f >= 0; f--) {
        if (s(a, d[f]))
          break;
        if (u.isTag(d[f]))
          l++;
      }
      return i(l) && e(a);
    };
  },
  "nth-of-type"(e, t, { adapter: u, equals: s }) {
    let i = Xe(t);
    if (i === Z.default.falseFunc)
      return Z.default.falseFunc;
    if (i === Z.default.trueFunc)
      return Xt(e, u);
    return function(a) {
      let d = u.getSiblings(a), l = 0;
      for (let f = 0;f < d.length; f++) {
        let T = d[f];
        if (s(a, T))
          break;
        if (u.isTag(T) && u.getName(T) === u.getName(a))
          l++;
      }
      return i(l) && e(a);
    };
  },
  "nth-last-of-type"(e, t, { adapter: u, equals: s }) {
    let i = Xe(t);
    if (i === Z.default.falseFunc)
      return Z.default.falseFunc;
    if (i === Z.default.trueFunc)
      return Xt(e, u);
    return function(a) {
      let d = u.getSiblings(a), l = 0;
      for (let f = d.length - 1;f >= 0; f--) {
        let T = d[f];
        if (s(a, T))
          break;
        if (u.isTag(T) && u.getName(T) === u.getName(a))
          l++;
      }
      return i(l) && e(a);
    };
  },
  root(e, t, { adapter: u }) {
    return (s) => {
      let i = u.getParent(s);
      return (i == null || !u.isTag(i)) && e(s);
    };
  },
  scope(e, t, u, s) {
    let { equals: i } = u;
    if (!s || s.length === 0)
      return Ve.root(e, t, u);
    if (s.length === 1)
      return (n) => i(s[0], n) && e(n);
    return (n) => s.includes(n) && e(n);
  },
  hover: Vu("isHovered"),
  visited: Vu("isVisited"),
  active: Vu("isActive")
};
function Vu(e) {
  return function(u, s, { adapter: i }) {
    let n = i[e];
    if (typeof n !== "function")
      return Z.default.falseFunc;
    return function(d) {
      return n(d) && u(d);
    };
  };
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/pseudo-selectors/pseudos.js
var dt = {
  empty(e, { adapter: t }) {
    return !t.getChildren(e).some((u) => t.isTag(u) || t.getText(u) !== "");
  },
  "first-child"(e, { adapter: t, equals: u }) {
    if (t.prevElementSibling)
      return t.prevElementSibling(e) == null;
    let s = t.getSiblings(e).find((i) => t.isTag(i));
    return s != null && u(e, s);
  },
  "last-child"(e, { adapter: t, equals: u }) {
    let s = t.getSiblings(e);
    for (let i = s.length - 1;i >= 0; i--) {
      if (u(e, s[i]))
        return !0;
      if (t.isTag(s[i]))
        break;
    }
    return !1;
  },
  "first-of-type"(e, { adapter: t, equals: u }) {
    let s = t.getSiblings(e), i = t.getName(e);
    for (let n = 0;n < s.length; n++) {
      let a = s[n];
      if (u(e, a))
        return !0;
      if (t.isTag(a) && t.getName(a) === i)
        break;
    }
    return !1;
  },
  "last-of-type"(e, { adapter: t, equals: u }) {
    let s = t.getSiblings(e), i = t.getName(e);
    for (let n = s.length - 1;n >= 0; n--) {
      let a = s[n];
      if (u(e, a))
        return !0;
      if (t.isTag(a) && t.getName(a) === i)
        break;
    }
    return !1;
  },
  "only-of-type"(e, { adapter: t, equals: u }) {
    let s = t.getName(e);
    return t.getSiblings(e).every((i) => u(e, i) || !t.isTag(i) || t.getName(i) !== s);
  },
  "only-child"(e, { adapter: t, equals: u }) {
    return t.getSiblings(e).every((s) => u(e, s) || !t.isTag(s));
  }
};
function qu(e, t, u, s) {
  if (u === null) {
    if (e.length > s)
      throw Error(`Pseudo-class :${t} requires an argument`);
  } else if (e.length === s)
    throw Error(`Pseudo-class :${t} doesn't have any arguments`);
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/pseudo-selectors/aliases.js
var Vt = {
  "any-link": ":is(a, area, link)[href]",
  link: ":any-link:not(:visited)",
  disabled: `:is(
        :is(button, input, select, textarea, optgroup, option)[disabled],
        optgroup[disabled] > option,
        fieldset[disabled]:not(fieldset[disabled] legend:first-of-type *)
    )`,
  enabled: ":not(:disabled)",
  checked: ":is(:is(input[type=radio], input[type=checkbox])[checked], option:selected)",
  required: ":is(input, select, textarea)[required]",
  optional: ":is(input, select, textarea):not([required])",
  selected: "option:is([selected], select:not([multiple]):not(:has(> option[selected])) > :first-of-type)",
  checkbox: "[type=checkbox]",
  file: "[type=file]",
  password: "[type=password]",
  radio: "[type=radio]",
  reset: "[type=reset]",
  image: "[type=image]",
  submit: "[type=submit]",
  parent: ":not(:empty)",
  header: ":is(h1, h2, h3, h4, h5, h6)",
  button: ":is(button, input[type=button])",
  input: ":is(input, textarea, select, button)",
  text: "input:is(:not([type!='']), [type=text])"
};

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/pseudo-selectors/subselects.js
var j = Be(Ie(), 1);
var $u = {};
function es(e, t) {
  if (e === j.default.falseFunc)
    return j.default.falseFunc;
  return (u) => t.isTag(u) && e(u);
}
function ts(e, t) {
  let u = t.getSiblings(e);
  if (u.length <= 1)
    return [];
  let s = u.indexOf(e);
  if (s < 0 || s === u.length - 1)
    return [];
  return u.slice(s + 1).filter(t.isTag);
}
function zu(e) {
  return {
    xmlMode: !!e.xmlMode,
    lowerCaseAttributeNames: !!e.lowerCaseAttributeNames,
    lowerCaseTags: !!e.lowerCaseTags,
    quirksMode: !!e.quirksMode,
    cacheResults: !!e.cacheResults,
    pseudos: e.pseudos,
    adapter: e.adapter,
    equals: e.equals
  };
}
var ju = (e, t, u, s, i) => {
  let n = i(t, zu(u), s);
  return n === j.default.trueFunc ? e : n === j.default.falseFunc ? j.default.falseFunc : (a) => n(a) && e(a);
}, qt = {
  is: ju,
  matches: ju,
  where: ju,
  not(e, t, u, s, i) {
    let n = i(t, zu(u), s);
    return n === j.default.falseFunc ? e : n === j.default.trueFunc ? j.default.falseFunc : (a) => !n(a) && e(a);
  },
  has(e, t, u, s, i) {
    let { adapter: n } = u, a = zu(u);
    a.relativeSelector = !0;
    let d = t.some((T) => T.some(At)) ? [$u] : void 0, l = i(t, a, d);
    if (l === j.default.falseFunc)
      return j.default.falseFunc;
    let f = es(l, n);
    if (d && l !== j.default.trueFunc) {
      let { shouldTestNextSiblings: T = !1 } = l;
      return (C) => {
        if (!e(C))
          return !1;
        d[0] = C;
        let I = n.getChildren(C), S = T ? [...I, ...ts(C, n)] : I;
        return n.existsOne(f, S);
      };
    }
    return (T) => e(T) && n.existsOne(f, n.getChildren(T));
  }
};

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/pseudo-selectors/index.js
function yr(e, t, u, s, i) {
  var n;
  let { name: a, data: d } = t;
  if (Array.isArray(d)) {
    if (!(a in qt))
      throw Error(`Unknown pseudo-class :${a}(${d})`);
    return qt[a](e, d, u, s, i);
  }
  let l = (n = u.pseudos) === null || n === void 0 ? void 0 : n[a], f = typeof l === "string" ? l : Vt[a];
  if (typeof f === "string") {
    if (d != null)
      throw Error(`Pseudo ${a} doesn't have any arguments`);
    let T = le(f);
    return qt.is(e, T, u, s, i);
  }
  if (typeof l === "function")
    return qu(l, a, d, 1), (T) => l(T, d) && e(T);
  if (a in Ve)
    return Ve[a](e, d, u, s);
  if (a in dt) {
    let T = dt[a];
    return qu(T, a, d, 2), (C) => T(C, u, d) && e(C);
  }
  throw Error(`Unknown pseudo-class :${a}`);
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/general.js
function us(e, t) {
  let u = t.getParent(e);
  if (u && t.isTag(u))
    return u;
  return null;
}
function Fr(e, t, u, s, i) {
  let { adapter: n, equals: a } = u;
  switch (t.type) {
    case _.PseudoElement:
      throw Error("Pseudo-elements are not supported by css-select");
    case _.ColumnCombinator:
      throw Error("Column combinators are not yet supported by css-select");
    case _.Attribute: {
      if (t.namespace != null)
        throw Error("Namespaced attributes are not yet supported by css-select");
      if (!u.xmlMode || u.lowerCaseAttributeNames)
        t.name = t.name.toLowerCase();
      return Or[t.action](e, t, u);
    }
    case _.Pseudo:
      return yr(e, t, u, s, i);
    case _.Tag: {
      if (t.namespace != null)
        throw Error("Namespaced tag names are not yet supported by css-select");
      let { name: d } = t;
      if (!u.xmlMode || u.lowerCaseTags)
        d = d.toLowerCase();
      return function(f) {
        return n.getName(f) === d && e(f);
      };
    }
    case _.Descendant: {
      if (u.cacheResults === !1 || typeof WeakSet > "u")
        return function(f) {
          let T = f;
          while (T = us(T, n))
            if (e(T))
              return !0;
          return !1;
        };
      let d = /* @__PURE__ */ new WeakSet;
      return function(f) {
        let T = f;
        while (T = us(T, n))
          if (!d.has(T)) {
            if (n.isTag(T) && e(T))
              return !0;
            d.add(T);
          }
        return !1;
      };
    }
    case "_flexibleDescendant":
      return function(l) {
        let f = l;
        do
          if (e(f))
            return !0;
        while (f = us(f, n));
        return !1;
      };
    case _.Parent:
      return function(l) {
        return n.getChildren(l).some((f) => n.isTag(f) && e(f));
      };
    case _.Child:
      return function(l) {
        let f = n.getParent(l);
        return f != null && n.isTag(f) && e(f);
      };
    case _.Sibling:
      return function(l) {
        let f = n.getSiblings(l);
        for (let T = 0;T < f.length; T++) {
          let C = f[T];
          if (a(l, C))
            break;
          if (n.isTag(C) && e(C))
            return !0;
        }
        return !1;
      };
    case _.Adjacent: {
      if (n.prevElementSibling)
        return function(l) {
          let f = n.prevElementSibling(l);
          return f != null && e(f);
        };
      return function(l) {
        let f = n.getSiblings(l), T;
        for (let C = 0;C < f.length; C++) {
          let I = f[C];
          if (a(l, I))
            break;
          if (n.isTag(I))
            T = I;
        }
        return !!T && e(T);
      };
    }
    case _.Universal: {
      if (t.namespace != null && t.namespace !== "*")
        throw Error("Namespaced universal selectors are not yet supported by css-select");
      return e;
    }
  }
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/compile.js
function Mr(e, t, u) {
  let s = jt(e, t, u);
  return es(s, t.adapter);
}
function jt(e, t, u) {
  let s = typeof e === "string" ? le(e) : e;
  return zt(s, t, u);
}
function wr(e) {
  return e.type === _.Pseudo && (e.name === "scope" || Array.isArray(e.data) && e.data.some((t) => t.some(wr)));
}
var Ba = { type: _.Descendant }, xa = {
  type: "_flexibleDescendant"
}, Oa = {
  type: _.Pseudo,
  name: "scope",
  data: null
};
function Ra(e, { adapter: t }, u) {
  let s = !!(u === null || u === void 0 ? void 0 : u.every((i) => {
    let n = t.isTag(i) && t.getParent(i);
    return i === $u || n && t.isTag(n);
  }));
  for (let i of e) {
    if (i.length > 0 && At(i[0]) && i[0].type !== _.Descendant)
      ;
    else if (s && !i.some(wr))
      i.unshift(Ba);
    else
      continue;
    i.unshift(Oa);
  }
}
function zt(e, t, u) {
  var s;
  e.forEach(Zu), u = (s = t.context) !== null && s !== void 0 ? s : u;
  let i = Array.isArray(u), n = u && (Array.isArray(u) ? u : [u]);
  if (t.relativeSelector !== !1)
    Ra(e, t, n);
  else if (e.some((l) => l.length > 0 && At(l[0])))
    throw Error("Relative selectors are not allowed when the `relativeSelector` option is disabled");
  let a = !1, d = e.map((l) => {
    if (l.length >= 2) {
      let [f, T] = l;
      if (f.type !== _.Pseudo || f.name !== "scope")
        ;
      else if (i && T.type === _.Descendant)
        l[1] = xa;
      else if (T.type === _.Adjacent || T.type === _.Sibling)
        a = !0;
    }
    return La(l, t, n);
  }).reduce(ya, he.default.falseFunc);
  return d.shouldTestNextSiblings = a, d;
}
function La(e, t, u) {
  var s;
  return e.reduce((i, n) => i === he.default.falseFunc ? he.default.falseFunc : Fr(i, n, t, u, zt), (s = t.rootFunc) !== null && s !== void 0 ? s : he.default.trueFunc);
}
function ya(e, t) {
  if (t === he.default.falseFunc || e === he.default.trueFunc)
    return e;
  if (e === he.default.falseFunc || t === he.default.trueFunc)
    return t;
  return function(s) {
    return e(s) || t(s);
  };
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/css-select/lib/esm/index.js
var kr = (e, t) => e === t, Fa = {
  adapter: pe,
  equals: kr
};
function Pr(e) {
  var t, u, s, i;
  let n = e !== null && e !== void 0 ? e : Fa;
  return (t = n.adapter) !== null && t !== void 0 || (n.adapter = pe), (u = n.equals) !== null && u !== void 0 || (n.equals = (i = (s = n.adapter) === null || s === void 0 ? void 0 : s.equals) !== null && i !== void 0 ? i : kr), n;
}
function rs(e) {
  return function(u, s, i) {
    let n = Pr(s);
    return e(u, n, i);
  };
}
var Ol = rs(Mr), Rl = rs(jt), $t = rs(zt);
function Hr(e) {
  return function(u, s, i) {
    let n = Pr(i);
    if (typeof u !== "function")
      u = jt(u, n, s);
    let a = eu(s, n.adapter, u.shouldTestNextSiblings);
    return e(u, a, n);
  };
}
function eu(e, t, u = !1) {
  if (u)
    e = Ma(e, t);
  return Array.isArray(e) ? t.removeSubsets(e) : t.getChildren(e);
}
function Ma(e, t) {
  let u = Array.isArray(e) ? e.slice(0) : [e], s = u.length;
  for (let i = 0;i < s; i++) {
    let n = ts(u[i], t);
    u.push(...n);
  }
  return u;
}
var Ll = Hr((e, t, u) => e === ss.default.falseFunc || !t || t.length === 0 ? [] : u.adapter.findAll(e, t)), yl = Hr((e, t, u) => e === ss.default.falseFunc || !t || t.length === 0 ? null : u.adapter.findOne(e, t));

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio-select/lib/esm/index.js
var uu = Be(Ie(), 1);

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio-select/lib/esm/positionals.js
var wa = /* @__PURE__ */ new Set([
  "first",
  "last",
  "eq",
  "gt",
  "nth",
  "lt",
  "even",
  "odd"
]);
function qe(e) {
  if (e.type !== "pseudo")
    return !1;
  if (wa.has(e.name))
    return !0;
  if (e.name === "not" && Array.isArray(e.data))
    return e.data.some((t) => t.some(qe));
  return !1;
}
function Ur(e, t, u) {
  let s = t != null ? parseInt(t, 10) : NaN;
  switch (e) {
    case "first":
      return 1;
    case "nth":
    case "eq":
      return isFinite(s) ? s >= 0 ? s + 1 : 1 / 0 : 0;
    case "lt":
      return isFinite(s) ? s >= 0 ? Math.min(s, u) : 1 / 0 : 0;
    case "gt":
      return isFinite(s) ? 1 / 0 : 0;
    case "odd":
      return 2 * u;
    case "even":
      return 2 * u - 1;
    case "last":
    case "not":
      return 1 / 0;
  }
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio-select/lib/esm/helpers.js
function Qr(e) {
  while (e.parent)
    e = e.parent;
  return e;
}
function tu(e) {
  let t = [], u = [];
  for (let s of e)
    if (s.some(qe))
      t.push(s);
    else
      u.push(s);
  return [u, t];
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio-select/lib/esm/index.js
var ka = {
  type: _.Universal,
  namespace: null
}, Pa = {
  type: _.Pseudo,
  name: "scope",
  data: null
};
function as(e, t, u = {}) {
  return cs([e], t, u);
}
function cs(e, t, u = {}) {
  if (typeof t === "function")
    return e.some(t);
  let [s, i] = tu(le(t));
  return s.length > 0 && e.some($t(s, u)) || i.some((n) => vr(n, e, u).length > 0);
}
function Ha(e, t, u, s) {
  let i = typeof u === "string" ? parseInt(u, 10) : NaN;
  switch (e) {
    case "first":
    case "lt":
      return t;
    case "last":
      return t.length > 0 ? [t[t.length - 1]] : t;
    case "nth":
    case "eq":
      return isFinite(i) && Math.abs(i) < t.length ? [i < 0 ? t[t.length + i] : t[i]] : [];
    case "gt":
      return isFinite(i) ? t.slice(i + 1) : [];
    case "even":
      return t.filter((n, a) => a % 2 === 0);
    case "odd":
      return t.filter((n, a) => a % 2 === 1);
    case "not": {
      let n = new Set(Yr(u, t, s));
      return t.filter((a) => !n.has(a));
    }
  }
}
function As(e, t, u = {}) {
  return Yr(le(e), t, u);
}
function Yr(e, t, u) {
  if (t.length === 0)
    return [];
  let [s, i] = tu(e), n;
  if (s.length) {
    let a = ns(t, s, u);
    if (i.length === 0)
      return a;
    if (a.length)
      n = new Set(a);
  }
  for (let a = 0;a < i.length && (n === null || n === void 0 ? void 0 : n.size) !== t.length; a++) {
    let d = i[a];
    if ((n ? t.filter((T) => p(T) && !n.has(T)) : t).length === 0)
      break;
    let f = vr(d, t, u);
    if (f.length)
      if (!n) {
        if (a === i.length - 1)
          return f;
        n = new Set(f);
      } else
        f.forEach((T) => n.add(T));
  }
  return typeof n < "u" ? n.size === t.length ? t : t.filter((a) => n.has(a)) : [];
}
function vr(e, t, u) {
  var s;
  if (e.some(ye)) {
    let i = (s = u.root) !== null && s !== void 0 ? s : Qr(t[0]), n = { ...u, context: t, relativeSelector: !1 };
    return e.push(Pa), su(i, e, n, !0, t.length);
  }
  return su(t, e, u, !1, t.length);
}
function Gr(e, t, u = {}, s = 1 / 0) {
  if (typeof e === "function")
    return Kr(t, e);
  let [i, n] = tu(le(e)), a = n.map((d) => su(t, d, u, !0, s));
  if (i.length)
    a.push(is(t, i, u, s));
  if (a.length === 0)
    return [];
  if (a.length === 1)
    return a[0];
  return ge(a.reduce((d, l) => [...d, ...l]));
}
function su(e, t, u, s, i) {
  let n = t.findIndex(qe), a = t.slice(0, n), d = t[n], l = t.length - 1 === n ? i : 1 / 0, f = Ur(d.name, d.data, l);
  if (f === 0)
    return [];
  let C = (a.length === 0 && !Array.isArray(e) ? Ke(e).filter(p) : a.length === 0 ? (Array.isArray(e) ? e : [e]).filter(p) : s || a.some(ye) ? is(e, [a], u, f) : ns(e, [a], u)).slice(0, f), I = Ha(d.name, C, d.data, u);
  if (I.length === 0 || t.length === n + 1)
    return I;
  let S = t.slice(n + 1), D = S.some(ye);
  if (D) {
    if (ye(S[0])) {
      let { type: k } = S[0];
      if (k === _.Sibling || k === _.Adjacent)
        I = eu(I, pe, !0);
      S.unshift(ka);
    }
    u = {
      ...u,
      relativeSelector: !1,
      rootFunc: (k) => I.includes(k)
    };
  } else if (u.rootFunc && u.rootFunc !== uu.trueFunc)
    u = { ...u, rootFunc: uu.trueFunc };
  return S.some(qe) ? su(I, S, u, !1, i) : D ? is(I, [S], u, i) : ns(I, [S], u);
}
function is(e, t, u, s) {
  let i = $t(t, u, e);
  return Kr(e, i, s);
}
function Kr(e, t, u = 1 / 0) {
  let s = eu(e, pe, t.shouldTestNextSiblings);
  return Ht((i) => p(i) && t(i), s, !0, u);
}
function ns(e, t, u) {
  let s = (Array.isArray(e) ? e : [e]).filter(p);
  if (s.length === 0)
    return s;
  let i = $t(t, u);
  return i === uu.trueFunc ? s : s.filter(i);
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/traversing.js
var Qa = /^\s*(?:[+~]|:scope\b)/;
function Ya(e) {
  if (!e)
    return this._make([]);
  if (typeof e !== "string") {
    let t = q(e) ? e.toArray() : [e], u = this.toArray();
    return this._make(t.filter((s) => u.some((i) => vt(i, s))));
  }
  return this._findBySelector(e, Number.POSITIVE_INFINITY);
}
function va(e, t) {
  var u;
  let s = this.toArray(), i = Qa.test(e) ? s : this.children().toArray(), n = {
    context: s,
    root: (u = this._root) === null || u === void 0 ? void 0 : u[0],
    xmlMode: this.options.xmlMode,
    lowerCaseTags: this.options.lowerCaseTags,
    lowerCaseAttributeNames: this.options.lowerCaseAttributeNames,
    pseudos: this.options.pseudos,
    quirksMode: this.options.quirksMode
  };
  return this._make(Gr(e, i, n, t));
}
function os(e) {
  return function(t, ...u) {
    return function(s) {
      var i;
      let n = e(t, this);
      if (s)
        n = hs(n, s, this.options.xmlMode, (i = this._root) === null || i === void 0 ? void 0 : i[0]);
      return this._make(this.length > 1 && n.length > 1 ? u.reduce((a, d) => d(a), n) : n);
    };
  };
}
var lt = os((e, t) => {
  let u = [];
  for (let s = 0;s < t.length; s++) {
    let i = e(t[s]);
    if (i.length > 0)
      u = u.concat(i);
  }
  return u;
}), ds = os((e, t) => {
  let u = [];
  for (let s = 0;s < t.length; s++) {
    let i = e(t[s]);
    if (i !== null)
      u.push(i);
  }
  return u;
});
function ls(e, ...t) {
  let u = null, s = os((i, n) => {
    let a = [];
    return L(n, (d) => {
      for (let l;l = i(d); d = l) {
        if (u === null || u === void 0 ? void 0 : u(l, a.length))
          break;
        a.push(l);
      }
    }), a;
  })(e, ...t);
  return function(i, n) {
    u = typeof i === "string" ? (d) => as(d, i, this.options) : i ? ht(i) : null;
    let a = s.call(this, n);
    return u = null, a;
  };
}
function je(e) {
  return e.length > 1 ? Array.from(new Set(e)) : e;
}
var Ga = ds(({ parent: e }) => e && !ne(e) ? e : null, je), Ka = lt((e) => {
  let t = [];
  while (e.parent && !ne(e.parent))
    t.push(e.parent), e = e.parent;
  return t;
}, ge, (e) => e.reverse()), Wa = ls(({ parent: e }) => e && !ne(e) ? e : null, ge, (e) => e.reverse());
function Ja(e) {
  var t;
  let u = [];
  if (!e)
    return this._make(u);
  let s = {
    xmlMode: this.options.xmlMode,
    root: (t = this._root) === null || t === void 0 ? void 0 : t[0]
  }, i = typeof e === "string" ? (n) => as(n, e, s) : ht(e);
  return L(this, (n) => {
    if (n && !ne(n) && !p(n))
      n = n.parent;
    while (n && p(n)) {
      if (i(n, 0)) {
        if (!u.includes(n))
          u.push(n);
        break;
      }
      n = n.parent;
    }
  }), this._make(u);
}
var Za = ds((e) => kt(e)), Xa = lt((e) => {
  let t = [];
  while (e.next)
    if (e = e.next, p(e))
      t.push(e);
  return t;
}, je), Va = ls((e) => kt(e), je), qa = ds((e) => Pt(e)), ja = lt((e) => {
  let t = [];
  while (e.prev)
    if (e = e.prev, p(e))
      t.push(e);
  return t;
}, je), za = ls((e) => Pt(e), je), $a = lt((e) => Lu(e).filter((t) => p(t) && t !== e), ge), ec = lt((e) => Ke(e).filter(p), je);
function tc() {
  let e = this.toArray().reduce((t, u) => O(u) ? t.concat(u.children) : t, []);
  return this._make(e);
}
function uc(e) {
  let t = 0, u = this.length;
  while (t < u && e.call(this[t], t, this[t]) !== !1)
    ++t;
  return this;
}
function sc(e) {
  let t = [];
  for (let u = 0;u < this.length; u++) {
    let s = this[u], i = e.call(s, u, s);
    if (i != null)
      t = t.concat(i);
  }
  return this._make(t);
}
function ht(e) {
  if (typeof e === "function")
    return (t, u) => e.call(t, u, t);
  if (q(e))
    return (t) => Array.prototype.includes.call(e, t);
  return function(t) {
    return e === t;
  };
}
function rc(e) {
  var t;
  return this._make(hs(this.toArray(), e, this.options.xmlMode, (t = this._root) === null || t === void 0 ? void 0 : t[0]));
}
function hs(e, t, u, s) {
  return typeof t === "string" ? As(t, e, { xmlMode: u, root: s }) : e.filter(ht(t));
}
function ic(e) {
  let t = this.toArray();
  return typeof e === "string" ? cs(t.filter(p), e, this.options) : e ? t.some(ht(e)) : !1;
}
function nc(e) {
  let t = this.toArray();
  if (typeof e === "string") {
    let u = new Set(As(e, t, this.options));
    t = t.filter((s) => !u.has(s));
  } else {
    let u = ht(e);
    t = t.filter((s, i) => !u(s, i));
  }
  return this._make(t);
}
function ac(e) {
  return this.filter(typeof e === "string" ? `:has(${e})` : (t, u) => this._make(u).find(e).length > 0);
}
function cc() {
  return this.length > 1 ? this._make(this[0]) : this;
}
function Ac() {
  return this.length > 0 ? this._make(this[this.length - 1]) : this;
}
function oc(e) {
  var t;
  if (e = +e, e === 0 && this.length <= 1)
    return this;
  if (e < 0)
    e = this.length + e;
  return this._make((t = this[e]) !== null && t !== void 0 ? t : []);
}
function dc(e) {
  if (e == null)
    return this.toArray();
  return this[e < 0 ? this.length + e : e];
}
function lc() {
  return Array.prototype.slice.call(this);
}
function hc(e) {
  let t, u;
  if (e == null)
    t = this.parent().children(), u = this[0];
  else if (typeof e === "string")
    t = this._make(e), u = this[0];
  else
    t = this, u = q(e) ? e[0] : e;
  return Array.prototype.indexOf.call(t, u);
}
function fc(e, t) {
  return this._make(Array.prototype.slice.call(this, e, t));
}
function Ec() {
  var e;
  return (e = this.prevObject) !== null && e !== void 0 ? e : this._make([]);
}
function mc(e, t) {
  let u = this._make(e, t), s = ge([...this.get(), ...u.get()]);
  return this._make(s);
}
function Tc(e) {
  return this.prevObject ? this.add(e ? this.prevObject.filter(e) : this.prevObject) : this;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/parse.js
function Wr(e) {
  return function(u, s, i, n) {
    if (typeof Buffer < "u" && Buffer.isBuffer(u))
      u = u.toString();
    if (typeof u === "string")
      return e(u, s, i, n);
    let a = u;
    if (!Array.isArray(a) && ne(a))
      return a;
    let d = new X([]);
    return Ce(a, d), d;
  };
}
function Ce(e, t) {
  let u = Array.isArray(e) ? e : [e];
  if (t)
    t.children = u;
  else
    t = null;
  for (let s = 0;s < u.length; s++) {
    let i = u[s];
    if (i.parent && i.parent.children !== u)
      oe(i);
    if (t)
      i.prev = u[s - 1] || null, i.next = u[s + 1] || null;
    else
      i.prev = i.next = null;
    i.parent = t;
  }
  return t;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/manipulation.js
function gc(e, t) {
  if (e == null)
    return [];
  if (typeof e === "string")
    return this._parse(e, this.options, !1, null).children.slice(0);
  if ("length" in e) {
    if (e.length === 1)
      return this._makeDomArray(e[0], t);
    let u = [];
    for (let s = 0;s < e.length; s++) {
      let i = e[s];
      if (typeof i === "object") {
        if (i == null)
          continue;
        if (!("length" in i)) {
          u.push(t ? Ge(i, !0) : i);
          continue;
        }
      }
      u.push(...this._makeDomArray(i, t));
    }
    return u;
  }
  return [t ? Ge(e, !0) : e];
}
function Jr(e) {
  return function(...t) {
    let u = this.length - 1;
    return L(this, (s, i) => {
      if (!O(s))
        return;
      let n = typeof t[0] === "function" ? t[0].call(s, i, this._render(s.children)) : t, a = this._makeDomArray(n, i < u);
      e(a, s.children, s);
    });
  };
}
function _e(e, t, u, s, i) {
  var n, a;
  let d = [
    t,
    u,
    ...s
  ], l = t === 0 ? null : e[t - 1], f = t + u >= e.length ? null : e[t + u];
  for (let T = 0;T < s.length; ++T) {
    let C = s[T], I = C.parent;
    if (I) {
      let D = I.children.indexOf(C);
      if (D !== -1) {
        if (I.children.splice(D, 1), i === I && t > D)
          d[0]--;
      }
    }
    if (C.parent = i, C.prev)
      C.prev.next = (n = C.next) !== null && n !== void 0 ? n : null;
    if (C.next)
      C.next.prev = (a = C.prev) !== null && a !== void 0 ? a : null;
    C.prev = T === 0 ? l : s[T - 1], C.next = T === s.length - 1 ? f : s[T + 1];
  }
  if (l)
    l.next = s[0];
  if (f)
    f.prev = s[s.length - 1];
  return e.splice(...d);
}
function bc(e) {
  return (q(e) ? e : this._make(e)).append(this), this;
}
function pc(e) {
  return (q(e) ? e : this._make(e)).prepend(this), this;
}
var Ic = Jr((e, t, u) => {
  _e(t, t.length, 0, e, u);
}), Cc = Jr((e, t, u) => {
  _e(t, 0, 0, e, u);
});
function Zr(e) {
  return function(t) {
    let u = this.length - 1, s = this.parents().last();
    for (let i = 0;i < this.length; i++) {
      let n = this[i], a = typeof t === "function" ? t.call(n, i, n) : typeof t === "string" && !rt(t) ? s.find(t).clone() : t, [d] = this._makeDomArray(a, i < u);
      if (!d || !O(d))
        continue;
      let l = d, f = 0;
      while (f < l.children.length) {
        let T = l.children[f];
        if (p(T))
          l = T, f = 0;
        else
          f++;
      }
      e(n, l, [d]);
    }
    return this;
  };
}
var _c = Zr((e, t, u) => {
  let { parent: s } = e;
  if (!s)
    return;
  let i = s.children, n = i.indexOf(e);
  Ce([e], t), _e(i, n, 0, u, s);
}), Nc = Zr((e, t, u) => {
  if (!O(e))
    return;
  Ce(e.children, t), Ce(u, e);
});
function Sc(e) {
  return this.parent(e).not("body").each((t, u) => {
    this._make(u).replaceWith(u.children);
  }), this;
}
function Dc(e) {
  let t = this[0];
  if (t) {
    let u = this._make(typeof e === "function" ? e.call(t, 0, t) : e).insertBefore(t), s;
    for (let n = 0;n < u.length; n++)
      if (u[n].type === xt)
        s = u[n];
    let i = 0;
    while (s && i < s.children.length) {
      let n = s.children[i];
      if (n.type === xt)
        s = n, i = 0;
      else
        i++;
    }
    if (s)
      this._make(s).append(this);
  }
  return this;
}
function Bc(...e) {
  let t = this.length - 1;
  return L(this, (u, s) => {
    if (!O(u) || !u.parent)
      return;
    let i = u.parent.children, n = i.indexOf(u);
    if (n === -1)
      return;
    let a = typeof e[0] === "function" ? e[0].call(u, s, this._render(u.children)) : e, d = this._makeDomArray(a, s < t);
    _e(i, n + 1, 0, d, u.parent);
  });
}
function xc(e) {
  if (typeof e === "string")
    e = this._make(e);
  this.remove();
  let t = [];
  for (let u of this._makeDomArray(e)) {
    let s = this.clone().toArray(), { parent: i } = u;
    if (!i)
      continue;
    let n = i.children, a = n.indexOf(u);
    if (a === -1)
      continue;
    _e(n, a + 1, 0, s, i), t.push(...s);
  }
  return this._make(t);
}
function Oc(...e) {
  let t = this.length - 1;
  return L(this, (u, s) => {
    if (!O(u) || !u.parent)
      return;
    let i = u.parent.children, n = i.indexOf(u);
    if (n === -1)
      return;
    let a = typeof e[0] === "function" ? e[0].call(u, s, this._render(u.children)) : e, d = this._makeDomArray(a, s < t);
    _e(i, n, 0, d, u.parent);
  });
}
function Rc(e) {
  let t = this._make(e);
  this.remove();
  let u = [];
  return L(t, (s) => {
    let i = this.clone().toArray(), { parent: n } = s;
    if (!n)
      return;
    let a = n.children, d = a.indexOf(s);
    if (d === -1)
      return;
    _e(a, d, 0, i, n), u.push(...i);
  }), this._make(u);
}
function Lc(e) {
  let t = e ? this.filter(e) : this;
  return L(t, (u) => {
    oe(u), u.prev = u.next = u.parent = null;
  }), this;
}
function yc(e) {
  return L(this, (t, u) => {
    let { parent: s } = t;
    if (!s)
      return;
    let i = s.children, n = typeof e === "function" ? e.call(t, u, t) : e, a = this._makeDomArray(n);
    Ce(a, null);
    let d = i.indexOf(t);
    if (_e(i, d, 1, a, s), !a.includes(t))
      t.parent = t.prev = t.next = null;
  });
}
function Fc() {
  return L(this, (e) => {
    if (!O(e))
      return;
    for (let t of e.children)
      t.next = t.prev = t.parent = null;
    e.children.length = 0;
  });
}
function Mc(e) {
  if (e === void 0) {
    let t = this[0];
    if (!t || !O(t))
      return null;
    return this._render(t.children);
  }
  return L(this, (t) => {
    if (!O(t))
      return;
    for (let s of t.children)
      s.next = s.prev = s.parent = null;
    let u = q(e) ? e.toArray() : this._parse(`${e}`, this.options, !1, t).children;
    Ce(u, t);
  });
}
function wc() {
  return this._render(this);
}
function kc(e) {
  if (e === void 0)
    return Re(this);
  if (typeof e === "function")
    return L(this, (t, u) => this._make(t).text(e.call(t, u, Re([t]))));
  return L(this, (t) => {
    if (!O(t))
      return;
    for (let s of t.children)
      s.next = s.prev = s.parent = null;
    let u = new ce(`${e}`);
    Ce(u, t);
  });
}
function Pc() {
  let e = Array.prototype.map.call(this.get(), (u) => Ge(u, !0)), t = new X(e);
  for (let u of e)
    u.parent = t;
  return this._make(e);
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/css.js
function Hc(e, t) {
  if (e != null && t != null || typeof e === "object" && !Array.isArray(e))
    return L(this, (u, s) => {
      if (p(u))
        Xr(u, e, t, s);
    });
  if (this.length === 0)
    return;
  return Vr(this[0], e);
}
function Xr(e, t, u, s) {
  if (typeof t === "string") {
    let i = Vr(e), n = typeof u === "function" ? u.call(e, s, i[t]) : u;
    if (n === "")
      delete i[t];
    else if (n != null)
      i[t] = n;
    e.attribs.style = Uc(i);
  } else if (typeof t === "object") {
    let i = Object.keys(t);
    for (let n = 0;n < i.length; n++) {
      let a = i[n];
      Xr(e, a, t[a], n);
    }
  }
}
function Vr(e, t) {
  if (!e || !p(e))
    return;
  let u = Qc(e.attribs.style);
  if (typeof t === "string")
    return u[t];
  if (Array.isArray(t)) {
    let s = {};
    for (let i of t)
      if (u[i] != null)
        s[i] = u[i];
    return s;
  }
  return u;
}
function Uc(e) {
  return Object.keys(e).reduce((t, u) => `${t}${t ? " " : ""}${u}: ${e[u]};`, "");
}
function Qc(e) {
  if (e = (e || "").trim(), !e)
    return {};
  let t = {}, u;
  for (let s of e.split(";")) {
    let i = s.indexOf(":");
    if (i < 1 || i === s.length - 1) {
      let n = s.trimEnd();
      if (n.length > 0 && u !== void 0)
        t[u] += `;${n}`;
    } else
      u = s.slice(0, i).trim(), t[u] = s.slice(i + 1).trim();
  }
  return t;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/forms.js
var qr = "input,select,textarea,keygen", Yc = /%20/g, jr = /\r?\n/g;
function vc() {
  return this.serializeArray().map((u) => `${encodeURIComponent(u.name)}=${encodeURIComponent(u.value)}`).join("&").replace(Yc, "+");
}
function Gc() {
  return this.map((e, t) => {
    let u = this._make(t);
    if (p(t) && t.name === "form")
      return u.find(qr).toArray();
    return u.filter(qr).toArray();
  }).filter('[name!=""]:enabled:not(:submit, :button, :image, :reset, :file):matches([checked], :not(:checkbox, :radio))').map((e, t) => {
    var u;
    let s = this._make(t), i = s.attr("name"), n = (u = s.val()) !== null && u !== void 0 ? u : "";
    if (Array.isArray(n))
      return n.map((a) => ({ name: i, value: a.replace(jr, `\r
`) }));
    return { name: i, value: n.replace(jr, `\r
`) };
  }).toArray();
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/api/extract.js
function Kc(e) {
  var t;
  if (typeof e === "string")
    return { selector: e, value: "textContent" };
  return {
    selector: e.selector,
    value: (t = e.value) !== null && t !== void 0 ? t : "textContent"
  };
}
function Wc(e) {
  let t = {};
  for (let u in e) {
    let s = e[u], i = Array.isArray(s), { selector: n, value: a } = Kc(i ? s[0] : s), d = typeof a === "function" ? a : typeof a === "string" ? (l) => this._make(l).prop(a) : (l) => this._make(l).extract(a);
    if (i)
      t[u] = this._findBySelector(n, Number.POSITIVE_INFINITY).map((l, f) => d(f, u, t)).get();
    else {
      let l = this._findBySelector(n, 1);
      t[u] = l.length > 0 ? d(l[0], u, t) : void 0;
    }
  }
  return t;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/cheerio.js
class Me {
  constructor(e, t, u) {
    if (this.length = 0, this.options = u, this._root = t, e) {
      for (let s = 0;s < e.length; s++)
        this[s] = e[s];
      this.length = e.length;
    }
  }
}
Me.prototype.cheerio = "[cheerio object]";
Me.prototype.splice = Array.prototype.splice;
Me.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
Object.assign(Me.prototype, Wu, fs, Es, ms, Ts, gs);

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/load.js
function zr(e, t) {
  return function u(s, i, n = !0) {
    if (s == null)
      throw Error("cheerio.load() expects a string");
    let a = tt(i), d = e(s, a, n, null);

    class l extends Me {
      _make(T, C) {
        let I = f(T, C);
        return I.prevObject = this, I;
      }
      _parse(T, C, I, S) {
        return e(T, C, I, S);
      }
      _render(T) {
        return t(T, this.options);
      }
    }
    function f(T, C, I = d, S) {
      if (T && q(T))
        return T;
      let D = tt(S, a), k = typeof I === "string" ? [e(I, D, !1, null)] : ("length" in I) ? I : [I], ee = q(k) ? k : new l(k, null, D);
      if (ee._root = ee, !T)
        return new l(void 0, ee, D);
      let He = typeof T === "string" && rt(T) ? e(T, D, !1, null).children : Jc(T) ? [T] : Array.isArray(T) ? T : void 0, Ue = new l(He, ee, D);
      if (He)
        return Ue;
      if (typeof T !== "string")
        throw TypeError("Unexpected type of selector");
      let $e = T, et = C ? typeof C === "string" ? rt(C) ? new l([e(C, D, !1, null)], ee, D) : ($e = `${C} ${$e}`, ee) : q(C) ? C : new l(Array.isArray(C) ? C : [C], ee, D) : ee;
      if (!et)
        return Ue;
      return et.find($e);
    }
    return Object.assign(f, Fu, {
      load: u,
      _root: d,
      _options: a,
      fn: l.prototype,
      prototype: l.prototype
    }), f;
  };
}
function Jc(e) {
  return !!e.name || e.type === Bt || e.type === Cu || e.type === _u;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/cheerio/dist/esm/slim.js
var $r = zr(Wr(fr), Mt);

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/common/unicode.js
var Zc = /* @__PURE__ */ new Set([
  65534,
  65535,
  131070,
  131071,
  196606,
  196607,
  262142,
  262143,
  327678,
  327679,
  393214,
  393215,
  458750,
  458751,
  524286,
  524287,
  589822,
  589823,
  655358,
  655359,
  720894,
  720895,
  786430,
  786431,
  851966,
  851967,
  917502,
  917503,
  983038,
  983039,
  1048574,
  1048575,
  1114110,
  1114111
]), y = "\uFFFD", c;
(function(e) {
  e[e.EOF = -1] = "EOF", e[e.NULL = 0] = "NULL", e[e.TABULATION = 9] = "TABULATION", e[e.CARRIAGE_RETURN = 13] = "CARRIAGE_RETURN", e[e.LINE_FEED = 10] = "LINE_FEED", e[e.FORM_FEED = 12] = "FORM_FEED", e[e.SPACE = 32] = "SPACE", e[e.EXCLAMATION_MARK = 33] = "EXCLAMATION_MARK", e[e.QUOTATION_MARK = 34] = "QUOTATION_MARK", e[e.AMPERSAND = 38] = "AMPERSAND", e[e.APOSTROPHE = 39] = "APOSTROPHE", e[e.HYPHEN_MINUS = 45] = "HYPHEN_MINUS", e[e.SOLIDUS = 47] = "SOLIDUS", e[e.DIGIT_0 = 48] = "DIGIT_0", e[e.DIGIT_9 = 57] = "DIGIT_9", e[e.SEMICOLON = 59] = "SEMICOLON", e[e.LESS_THAN_SIGN = 60] = "LESS_THAN_SIGN", e[e.EQUALS_SIGN = 61] = "EQUALS_SIGN", e[e.GREATER_THAN_SIGN = 62] = "GREATER_THAN_SIGN", e[e.QUESTION_MARK = 63] = "QUESTION_MARK", e[e.LATIN_CAPITAL_A = 65] = "LATIN_CAPITAL_A", e[e.LATIN_CAPITAL_Z = 90] = "LATIN_CAPITAL_Z", e[e.RIGHT_SQUARE_BRACKET = 93] = "RIGHT_SQUARE_BRACKET", e[e.GRAVE_ACCENT = 96] = "GRAVE_ACCENT", e[e.LATIN_SMALL_A = 97] = "LATIN_SMALL_A", e[e.LATIN_SMALL_Z = 122] = "LATIN_SMALL_Z";
})(c || (c = {}));
var K = {
  DASH_DASH: "--",
  CDATA_START: "[CDATA[",
  DOCTYPE: "doctype",
  SCRIPT: "script",
  PUBLIC: "public",
  SYSTEM: "system"
};
function ru(e) {
  return e >= 55296 && e <= 57343;
}
function ei(e) {
  return e >= 56320 && e <= 57343;
}
function ti(e, t) {
  return (e - 55296) * 1024 + 9216 + t;
}
function iu(e) {
  return e !== 32 && e !== 10 && e !== 13 && e !== 9 && e !== 12 && e >= 1 && e <= 31 || e >= 127 && e <= 159;
}
function nu(e) {
  return e >= 64976 && e <= 65007 || Zc.has(e);
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/common/error-codes.js
var E;
(function(e) {
  e.controlCharacterInInputStream = "control-character-in-input-stream", e.noncharacterInInputStream = "noncharacter-in-input-stream", e.surrogateInInputStream = "surrogate-in-input-stream", e.nonVoidHtmlElementStartTagWithTrailingSolidus = "non-void-html-element-start-tag-with-trailing-solidus", e.endTagWithAttributes = "end-tag-with-attributes", e.endTagWithTrailingSolidus = "end-tag-with-trailing-solidus", e.unexpectedSolidusInTag = "unexpected-solidus-in-tag", e.unexpectedNullCharacter = "unexpected-null-character", e.unexpectedQuestionMarkInsteadOfTagName = "unexpected-question-mark-instead-of-tag-name", e.invalidFirstCharacterOfTagName = "invalid-first-character-of-tag-name", e.unexpectedEqualsSignBeforeAttributeName = "unexpected-equals-sign-before-attribute-name", e.missingEndTagName = "missing-end-tag-name", e.unexpectedCharacterInAttributeName = "unexpected-character-in-attribute-name", e.unknownNamedCharacterReference = "unknown-named-character-reference", e.missingSemicolonAfterCharacterReference = "missing-semicolon-after-character-reference", e.unexpectedCharacterAfterDoctypeSystemIdentifier = "unexpected-character-after-doctype-system-identifier", e.unexpectedCharacterInUnquotedAttributeValue = "unexpected-character-in-unquoted-attribute-value", e.eofBeforeTagName = "eof-before-tag-name", e.eofInTag = "eof-in-tag", e.missingAttributeValue = "missing-attribute-value", e.missingWhitespaceBetweenAttributes = "missing-whitespace-between-attributes", e.missingWhitespaceAfterDoctypePublicKeyword = "missing-whitespace-after-doctype-public-keyword", e.missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers = "missing-whitespace-between-doctype-public-and-system-identifiers", e.missingWhitespaceAfterDoctypeSystemKeyword = "missing-whitespace-after-doctype-system-keyword", e.missingQuoteBeforeDoctypePublicIdentifier = "missing-quote-before-doctype-public-identifier", e.missingQuoteBeforeDoctypeSystemIdentifier = "missing-quote-before-doctype-system-identifier", e.missingDoctypePublicIdentifier = "missing-doctype-public-identifier", e.missingDoctypeSystemIdentifier = "missing-doctype-system-identifier", e.abruptDoctypePublicIdentifier = "abrupt-doctype-public-identifier", e.abruptDoctypeSystemIdentifier = "abrupt-doctype-system-identifier", e.cdataInHtmlContent = "cdata-in-html-content", e.incorrectlyOpenedComment = "incorrectly-opened-comment", e.eofInScriptHtmlCommentLikeText = "eof-in-script-html-comment-like-text", e.eofInDoctype = "eof-in-doctype", e.nestedComment = "nested-comment", e.abruptClosingOfEmptyComment = "abrupt-closing-of-empty-comment", e.eofInComment = "eof-in-comment", e.incorrectlyClosedComment = "incorrectly-closed-comment", e.eofInCdata = "eof-in-cdata", e.absenceOfDigitsInNumericCharacterReference = "absence-of-digits-in-numeric-character-reference", e.nullCharacterReference = "null-character-reference", e.surrogateCharacterReference = "surrogate-character-reference", e.characterReferenceOutsideUnicodeRange = "character-reference-outside-unicode-range", e.controlCharacterReference = "control-character-reference", e.noncharacterCharacterReference = "noncharacter-character-reference", e.missingWhitespaceBeforeDoctypeName = "missing-whitespace-before-doctype-name", e.missingDoctypeName = "missing-doctype-name", e.invalidCharacterSequenceAfterDoctypeName = "invalid-character-sequence-after-doctype-name", e.duplicateAttribute = "duplicate-attribute", e.nonConformingDoctype = "non-conforming-doctype", e.missingDoctype = "missing-doctype", e.misplacedDoctype = "misplaced-doctype", e.endTagWithoutMatchingOpenElement = "end-tag-without-matching-open-element", e.closingOfElementWithOpenChildElements = "closing-of-element-with-open-child-elements", e.disallowedContentInNoscriptInHead = "disallowed-content-in-noscript-in-head", e.openElementsLeftAfterEof = "open-elements-left-after-eof", e.abandonedHeadElementChild = "abandoned-head-element-child", e.misplacedStartTagForHeadElement = "misplaced-start-tag-for-head-element", e.nestedNoscriptInHead = "nested-noscript-in-head", e.eofInElementThatCanContainOnlyText = "eof-in-element-that-can-contain-only-text";
})(E || (E = {}));

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/tokenizer/preprocessor.js
var Vc = 65536;

class bs {
  constructor(e) {
    this.handler = e, this.html = "", this.pos = -1, this.lastGapPos = -2, this.gapStack = [], this.skipNextNewLine = !1, this.lastChunkWritten = !1, this.endOfChunkHit = !1, this.bufferWaterline = Vc, this.isEol = !1, this.lineStartPos = 0, this.droppedBufferSize = 0, this.line = 1, this.lastErrOffset = -1;
  }
  get col() {
    return this.pos - this.lineStartPos + Number(this.lastGapPos !== this.pos);
  }
  get offset() {
    return this.droppedBufferSize + this.pos;
  }
  getError(e, t) {
    let { line: u, col: s, offset: i } = this, n = s + t, a = i + t;
    return {
      code: e,
      startLine: u,
      endLine: u,
      startCol: n,
      endCol: n,
      startOffset: a,
      endOffset: a
    };
  }
  _err(e) {
    if (this.handler.onParseError && this.lastErrOffset !== this.offset)
      this.lastErrOffset = this.offset, this.handler.onParseError(this.getError(e, 0));
  }
  _addGap() {
    this.gapStack.push(this.lastGapPos), this.lastGapPos = this.pos;
  }
  _processSurrogate(e) {
    if (this.pos !== this.html.length - 1) {
      let t = this.html.charCodeAt(this.pos + 1);
      if (ei(t))
        return this.pos++, this._addGap(), ti(e, t);
    } else if (!this.lastChunkWritten)
      return this.endOfChunkHit = !0, c.EOF;
    return this._err(E.surrogateInInputStream), e;
  }
  willDropParsedChunk() {
    return this.pos > this.bufferWaterline;
  }
  dropParsedChunk() {
    if (this.willDropParsedChunk())
      this.html = this.html.substring(this.pos), this.lineStartPos -= this.pos, this.droppedBufferSize += this.pos, this.pos = 0, this.lastGapPos = -2, this.gapStack.length = 0;
  }
  write(e, t) {
    if (this.html.length > 0)
      this.html += e;
    else
      this.html = e;
    this.endOfChunkHit = !1, this.lastChunkWritten = t;
  }
  insertHtmlAtCurrentPos(e) {
    this.html = this.html.substring(0, this.pos + 1) + e + this.html.substring(this.pos + 1), this.endOfChunkHit = !1;
  }
  startsWith(e, t) {
    if (this.pos + e.length > this.html.length)
      return this.endOfChunkHit = !this.lastChunkWritten, !1;
    if (t)
      return this.html.startsWith(e, this.pos);
    for (let u = 0;u < e.length; u++)
      if ((this.html.charCodeAt(this.pos + u) | 32) !== e.charCodeAt(u))
        return !1;
    return !0;
  }
  peek(e) {
    let t = this.pos + e;
    if (t >= this.html.length)
      return this.endOfChunkHit = !this.lastChunkWritten, c.EOF;
    let u = this.html.charCodeAt(t);
    return u === c.CARRIAGE_RETURN ? c.LINE_FEED : u;
  }
  advance() {
    if (this.pos++, this.isEol)
      this.isEol = !1, this.line++, this.lineStartPos = this.pos;
    if (this.pos >= this.html.length)
      return this.endOfChunkHit = !this.lastChunkWritten, c.EOF;
    let e = this.html.charCodeAt(this.pos);
    if (e === c.CARRIAGE_RETURN)
      return this.isEol = !0, this.skipNextNewLine = !0, c.LINE_FEED;
    if (e === c.LINE_FEED) {
      if (this.isEol = !0, this.skipNextNewLine)
        return this.line--, this.skipNextNewLine = !1, this._addGap(), this.advance();
    }
    if (this.skipNextNewLine = !1, ru(e))
      e = this._processSurrogate(e);
    if (!(this.handler.onParseError === null || e > 31 && e < 127 || e === c.LINE_FEED || e === c.CARRIAGE_RETURN || e > 159 && e < 64976))
      this._checkForProblematicCharacters(e);
    return e;
  }
  _checkForProblematicCharacters(e) {
    if (iu(e))
      this._err(E.controlCharacterInInputStream);
    else if (nu(e))
      this._err(E.noncharacterInInputStream);
  }
  retreat(e) {
    this.pos -= e;
    while (this.pos < this.lastGapPos)
      this.lastGapPos = this.gapStack.pop(), this.pos--;
    this.isEol = !1;
  }
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/common/token.js
var B;
(function(e) {
  e[e.CHARACTER = 0] = "CHARACTER", e[e.NULL_CHARACTER = 1] = "NULL_CHARACTER", e[e.WHITESPACE_CHARACTER = 2] = "WHITESPACE_CHARACTER", e[e.START_TAG = 3] = "START_TAG", e[e.END_TAG = 4] = "END_TAG", e[e.COMMENT = 5] = "COMMENT", e[e.DOCTYPE = 6] = "DOCTYPE", e[e.EOF = 7] = "EOF", e[e.HIBERNATION = 8] = "HIBERNATION";
})(B || (B = {}));
function au(e, t) {
  for (let u = e.attrs.length - 1;u >= 0; u--)
    if (e.attrs[u].name === t)
      return e.attrs[u].value;
  return null;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/node_modules/entities/dist/esm/generated/decode-data-html.js
var ps = /* @__PURE__ */ new Uint16Array(/* @__PURE__ */ "\u1D41<\xD5\u0131\u028A\u049D\u057B\u05D0\u0675\u06DE\u07A2\u07D6\u080F\u0A4A\u0A91\u0DA1\u0E6D\u0F09\u0F26\u10CA\u1228\u12E1\u1415\u149D\u14C3\u14DF\u1525\x00\x00\x00\x00\x00\x00\u156B\u16CD\u198D\u1C12\u1DDD\u1F7E\u2060\u21B0\u228D\u23C0\u23FB\u2442\u2824\u2912\u2D08\u2E48\u2FCE\u3016\u32BA\u3639\u37AC\u38FE\u3A28\u3A71\u3AE0\u3B2E\u0800EMabcfglmnoprstu\\bfms\x7F\x84\x8B\x90\x95\x98\xA6\xB3\xB9\xC8\xCFlig\u803B\xC6\u40C6P\u803B&\u4026cute\u803B\xC1\u40C1reve;\u4102\u0100iyx}rc\u803B\xC2\u40C2;\u4410r;\uC000\uD835\uDD04rave\u803B\xC0\u40C0pha;\u4391acr;\u4100d;\u6A53\u0100gp\x9D\xA1on;\u4104f;\uC000\uD835\uDD38plyFunction;\u6061ing\u803B\xC5\u40C5\u0100cs\xBE\xC3r;\uC000\uD835\uDC9Cign;\u6254ilde\u803B\xC3\u40C3ml\u803B\xC4\u40C4\u0400aceforsu\xE5\xFB\xFE\u0117\u011C\u0122\u0127\u012A\u0100cr\xEA\xF2kslash;\u6216\u0176\xF6\xF8;\u6AE7ed;\u6306y;\u4411\u0180crt\u0105\u010B\u0114ause;\u6235noullis;\u612Ca;\u4392r;\uC000\uD835\uDD05pf;\uC000\uD835\uDD39eve;\u42D8c\xF2\u0113mpeq;\u624E\u0700HOacdefhilorsu\u014D\u0151\u0156\u0180\u019E\u01A2\u01B5\u01B7\u01BA\u01DC\u0215\u0273\u0278\u027Ecy;\u4427PY\u803B\xA9\u40A9\u0180cpy\u015D\u0162\u017Aute;\u4106\u0100;i\u0167\u0168\u62D2talDifferentialD;\u6145leys;\u612D\u0200aeio\u0189\u018E\u0194\u0198ron;\u410Cdil\u803B\xC7\u40C7rc;\u4108nint;\u6230ot;\u410A\u0100dn\u01A7\u01ADilla;\u40B8terDot;\u40B7\xF2\u017Fi;\u43A7rcle\u0200DMPT\u01C7\u01CB\u01D1\u01D6ot;\u6299inus;\u6296lus;\u6295imes;\u6297o\u0100cs\u01E2\u01F8kwiseContourIntegral;\u6232eCurly\u0100DQ\u0203\u020FoubleQuote;\u601Duote;\u6019\u0200lnpu\u021E\u0228\u0247\u0255on\u0100;e\u0225\u0226\u6237;\u6A74\u0180git\u022F\u0236\u023Aruent;\u6261nt;\u622FourIntegral;\u622E\u0100fr\u024C\u024E;\u6102oduct;\u6210nterClockwiseContourIntegral;\u6233oss;\u6A2Fcr;\uC000\uD835\uDC9Ep\u0100;C\u0284\u0285\u62D3ap;\u624D\u0580DJSZacefios\u02A0\u02AC\u02B0\u02B4\u02B8\u02CB\u02D7\u02E1\u02E6\u0333\u048D\u0100;o\u0179\u02A5trahd;\u6911cy;\u4402cy;\u4405cy;\u440F\u0180grs\u02BF\u02C4\u02C7ger;\u6021r;\u61A1hv;\u6AE4\u0100ay\u02D0\u02D5ron;\u410E;\u4414l\u0100;t\u02DD\u02DE\u6207a;\u4394r;\uC000\uD835\uDD07\u0100af\u02EB\u0327\u0100cm\u02F0\u0322ritical\u0200ADGT\u0300\u0306\u0316\u031Ccute;\u40B4o\u0174\u030B\u030D;\u42D9bleAcute;\u42DDrave;\u4060ilde;\u42DCond;\u62C4ferentialD;\u6146\u0470\u033D\x00\x00\x00\u0342\u0354\x00\u0405f;\uC000\uD835\uDD3B\u0180;DE\u0348\u0349\u034D\u40A8ot;\u60DCqual;\u6250ble\u0300CDLRUV\u0363\u0372\u0382\u03CF\u03E2\u03F8ontourIntegra\xEC\u0239o\u0274\u0379\x00\x00\u037B\xBB\u0349nArrow;\u61D3\u0100eo\u0387\u03A4ft\u0180ART\u0390\u0396\u03A1rrow;\u61D0ightArrow;\u61D4e\xE5\u02CAng\u0100LR\u03AB\u03C4eft\u0100AR\u03B3\u03B9rrow;\u67F8ightArrow;\u67FAightArrow;\u67F9ight\u0100AT\u03D8\u03DErrow;\u61D2ee;\u62A8p\u0241\u03E9\x00\x00\u03EFrrow;\u61D1ownArrow;\u61D5erticalBar;\u6225n\u0300ABLRTa\u0412\u042A\u0430\u045E\u047F\u037Crrow\u0180;BU\u041D\u041E\u0422\u6193ar;\u6913pArrow;\u61F5reve;\u4311eft\u02D2\u043A\x00\u0446\x00\u0450ightVector;\u6950eeVector;\u695Eector\u0100;B\u0459\u045A\u61BDar;\u6956ight\u01D4\u0467\x00\u0471eeVector;\u695Fector\u0100;B\u047A\u047B\u61C1ar;\u6957ee\u0100;A\u0486\u0487\u62A4rrow;\u61A7\u0100ct\u0492\u0497r;\uC000\uD835\uDC9Frok;\u4110\u0800NTacdfglmopqstux\u04BD\u04C0\u04C4\u04CB\u04DE\u04E2\u04E7\u04EE\u04F5\u0521\u052F\u0536\u0552\u055D\u0560\u0565G;\u414AH\u803B\xD0\u40D0cute\u803B\xC9\u40C9\u0180aiy\u04D2\u04D7\u04DCron;\u411Arc\u803B\xCA\u40CA;\u442Dot;\u4116r;\uC000\uD835\uDD08rave\u803B\xC8\u40C8ement;\u6208\u0100ap\u04FA\u04FEcr;\u4112ty\u0253\u0506\x00\x00\u0512mallSquare;\u65FBerySmallSquare;\u65AB\u0100gp\u0526\u052Aon;\u4118f;\uC000\uD835\uDD3Csilon;\u4395u\u0100ai\u053C\u0549l\u0100;T\u0542\u0543\u6A75ilde;\u6242librium;\u61CC\u0100ci\u0557\u055Ar;\u6130m;\u6A73a;\u4397ml\u803B\xCB\u40CB\u0100ip\u056A\u056Fsts;\u6203onentialE;\u6147\u0280cfios\u0585\u0588\u058D\u05B2\u05CCy;\u4424r;\uC000\uD835\uDD09lled\u0253\u0597\x00\x00\u05A3mallSquare;\u65FCerySmallSquare;\u65AA\u0370\u05BA\x00\u05BF\x00\x00\u05C4f;\uC000\uD835\uDD3DAll;\u6200riertrf;\u6131c\xF2\u05CB\u0600JTabcdfgorst\u05E8\u05EC\u05EF\u05FA\u0600\u0612\u0616\u061B\u061D\u0623\u066C\u0672cy;\u4403\u803B>\u403Emma\u0100;d\u05F7\u05F8\u4393;\u43DCreve;\u411E\u0180eiy\u0607\u060C\u0610dil;\u4122rc;\u411C;\u4413ot;\u4120r;\uC000\uD835\uDD0A;\u62D9pf;\uC000\uD835\uDD3Eeater\u0300EFGLST\u0635\u0644\u064E\u0656\u065B\u0666qual\u0100;L\u063E\u063F\u6265ess;\u62DBullEqual;\u6267reater;\u6AA2ess;\u6277lantEqual;\u6A7Eilde;\u6273cr;\uC000\uD835\uDCA2;\u626B\u0400Aacfiosu\u0685\u068B\u0696\u069B\u069E\u06AA\u06BE\u06CARDcy;\u442A\u0100ct\u0690\u0694ek;\u42C7;\u405Eirc;\u4124r;\u610ClbertSpace;\u610B\u01F0\u06AF\x00\u06B2f;\u610DizontalLine;\u6500\u0100ct\u06C3\u06C5\xF2\u06A9rok;\u4126mp\u0144\u06D0\u06D8ownHum\xF0\u012Fqual;\u624F\u0700EJOacdfgmnostu\u06FA\u06FE\u0703\u0707\u070E\u071A\u071E\u0721\u0728\u0744\u0778\u078B\u078F\u0795cy;\u4415lig;\u4132cy;\u4401cute\u803B\xCD\u40CD\u0100iy\u0713\u0718rc\u803B\xCE\u40CE;\u4418ot;\u4130r;\u6111rave\u803B\xCC\u40CC\u0180;ap\u0720\u072F\u073F\u0100cg\u0734\u0737r;\u412AinaryI;\u6148lie\xF3\u03DD\u01F4\u0749\x00\u0762\u0100;e\u074D\u074E\u622C\u0100gr\u0753\u0758ral;\u622Bsection;\u62C2isible\u0100CT\u076C\u0772omma;\u6063imes;\u6062\u0180gpt\u077F\u0783\u0788on;\u412Ef;\uC000\uD835\uDD40a;\u4399cr;\u6110ilde;\u4128\u01EB\u079A\x00\u079Ecy;\u4406l\u803B\xCF\u40CF\u0280cfosu\u07AC\u07B7\u07BC\u07C2\u07D0\u0100iy\u07B1\u07B5rc;\u4134;\u4419r;\uC000\uD835\uDD0Dpf;\uC000\uD835\uDD41\u01E3\u07C7\x00\u07CCr;\uC000\uD835\uDCA5rcy;\u4408kcy;\u4404\u0380HJacfos\u07E4\u07E8\u07EC\u07F1\u07FD\u0802\u0808cy;\u4425cy;\u440Cppa;\u439A\u0100ey\u07F6\u07FBdil;\u4136;\u441Ar;\uC000\uD835\uDD0Epf;\uC000\uD835\uDD42cr;\uC000\uD835\uDCA6\u0580JTaceflmost\u0825\u0829\u082C\u0850\u0863\u09B3\u09B8\u09C7\u09CD\u0A37\u0A47cy;\u4409\u803B<\u403C\u0280cmnpr\u0837\u083C\u0841\u0844\u084Dute;\u4139bda;\u439Bg;\u67EAlacetrf;\u6112r;\u619E\u0180aey\u0857\u085C\u0861ron;\u413Ddil;\u413B;\u441B\u0100fs\u0868\u0970t\u0500ACDFRTUVar\u087E\u08A9\u08B1\u08E0\u08E6\u08FC\u092F\u095B\u0390\u096A\u0100nr\u0883\u088FgleBracket;\u67E8row\u0180;BR\u0899\u089A\u089E\u6190ar;\u61E4ightArrow;\u61C6eiling;\u6308o\u01F5\u08B7\x00\u08C3bleBracket;\u67E6n\u01D4\u08C8\x00\u08D2eeVector;\u6961ector\u0100;B\u08DB\u08DC\u61C3ar;\u6959loor;\u630Aight\u0100AV\u08EF\u08F5rrow;\u6194ector;\u694E\u0100er\u0901\u0917e\u0180;AV\u0909\u090A\u0910\u62A3rrow;\u61A4ector;\u695Aiangle\u0180;BE\u0924\u0925\u0929\u62B2ar;\u69CFqual;\u62B4p\u0180DTV\u0937\u0942\u094CownVector;\u6951eeVector;\u6960ector\u0100;B\u0956\u0957\u61BFar;\u6958ector\u0100;B\u0965\u0966\u61BCar;\u6952ight\xE1\u039Cs\u0300EFGLST\u097E\u098B\u0995\u099D\u09A2\u09ADqualGreater;\u62DAullEqual;\u6266reater;\u6276ess;\u6AA1lantEqual;\u6A7Dilde;\u6272r;\uC000\uD835\uDD0F\u0100;e\u09BD\u09BE\u62D8ftarrow;\u61DAidot;\u413F\u0180npw\u09D4\u0A16\u0A1Bg\u0200LRlr\u09DE\u09F7\u0A02\u0A10eft\u0100AR\u09E6\u09ECrrow;\u67F5ightArrow;\u67F7ightArrow;\u67F6eft\u0100ar\u03B3\u0A0Aight\xE1\u03BFight\xE1\u03CAf;\uC000\uD835\uDD43er\u0100LR\u0A22\u0A2CeftArrow;\u6199ightArrow;\u6198\u0180cht\u0A3E\u0A40\u0A42\xF2\u084C;\u61B0rok;\u4141;\u626A\u0400acefiosu\u0A5A\u0A5D\u0A60\u0A77\u0A7C\u0A85\u0A8B\u0A8Ep;\u6905y;\u441C\u0100dl\u0A65\u0A6FiumSpace;\u605Flintrf;\u6133r;\uC000\uD835\uDD10nusPlus;\u6213pf;\uC000\uD835\uDD44c\xF2\u0A76;\u439C\u0480Jacefostu\u0AA3\u0AA7\u0AAD\u0AC0\u0B14\u0B19\u0D91\u0D97\u0D9Ecy;\u440Acute;\u4143\u0180aey\u0AB4\u0AB9\u0ABEron;\u4147dil;\u4145;\u441D\u0180gsw\u0AC7\u0AF0\u0B0Eative\u0180MTV\u0AD3\u0ADF\u0AE8ediumSpace;\u600Bhi\u0100cn\u0AE6\u0AD8\xEB\u0AD9eryThi\xEE\u0AD9ted\u0100GL\u0AF8\u0B06reaterGreate\xF2\u0673essLes\xF3\u0A48Line;\u400Ar;\uC000\uD835\uDD11\u0200Bnpt\u0B22\u0B28\u0B37\u0B3Areak;\u6060BreakingSpace;\u40A0f;\u6115\u0680;CDEGHLNPRSTV\u0B55\u0B56\u0B6A\u0B7C\u0BA1\u0BEB\u0C04\u0C5E\u0C84\u0CA6\u0CD8\u0D61\u0D85\u6AEC\u0100ou\u0B5B\u0B64ngruent;\u6262pCap;\u626DoubleVerticalBar;\u6226\u0180lqx\u0B83\u0B8A\u0B9Bement;\u6209ual\u0100;T\u0B92\u0B93\u6260ilde;\uC000\u2242\u0338ists;\u6204reater\u0380;EFGLST\u0BB6\u0BB7\u0BBD\u0BC9\u0BD3\u0BD8\u0BE5\u626Fqual;\u6271ullEqual;\uC000\u2267\u0338reater;\uC000\u226B\u0338ess;\u6279lantEqual;\uC000\u2A7E\u0338ilde;\u6275ump\u0144\u0BF2\u0BFDownHump;\uC000\u224E\u0338qual;\uC000\u224F\u0338e\u0100fs\u0C0A\u0C27tTriangle\u0180;BE\u0C1A\u0C1B\u0C21\u62EAar;\uC000\u29CF\u0338qual;\u62ECs\u0300;EGLST\u0C35\u0C36\u0C3C\u0C44\u0C4B\u0C58\u626Equal;\u6270reater;\u6278ess;\uC000\u226A\u0338lantEqual;\uC000\u2A7D\u0338ilde;\u6274ested\u0100GL\u0C68\u0C79reaterGreater;\uC000\u2AA2\u0338essLess;\uC000\u2AA1\u0338recedes\u0180;ES\u0C92\u0C93\u0C9B\u6280qual;\uC000\u2AAF\u0338lantEqual;\u62E0\u0100ei\u0CAB\u0CB9verseElement;\u620CghtTriangle\u0180;BE\u0CCB\u0CCC\u0CD2\u62EBar;\uC000\u29D0\u0338qual;\u62ED\u0100qu\u0CDD\u0D0CuareSu\u0100bp\u0CE8\u0CF9set\u0100;E\u0CF0\u0CF3\uC000\u228F\u0338qual;\u62E2erset\u0100;E\u0D03\u0D06\uC000\u2290\u0338qual;\u62E3\u0180bcp\u0D13\u0D24\u0D4Eset\u0100;E\u0D1B\u0D1E\uC000\u2282\u20D2qual;\u6288ceeds\u0200;EST\u0D32\u0D33\u0D3B\u0D46\u6281qual;\uC000\u2AB0\u0338lantEqual;\u62E1ilde;\uC000\u227F\u0338erset\u0100;E\u0D58\u0D5B\uC000\u2283\u20D2qual;\u6289ilde\u0200;EFT\u0D6E\u0D6F\u0D75\u0D7F\u6241qual;\u6244ullEqual;\u6247ilde;\u6249erticalBar;\u6224cr;\uC000\uD835\uDCA9ilde\u803B\xD1\u40D1;\u439D\u0700Eacdfgmoprstuv\u0DBD\u0DC2\u0DC9\u0DD5\u0DDB\u0DE0\u0DE7\u0DFC\u0E02\u0E20\u0E22\u0E32\u0E3F\u0E44lig;\u4152cute\u803B\xD3\u40D3\u0100iy\u0DCE\u0DD3rc\u803B\xD4\u40D4;\u441Eblac;\u4150r;\uC000\uD835\uDD12rave\u803B\xD2\u40D2\u0180aei\u0DEE\u0DF2\u0DF6cr;\u414Cga;\u43A9cron;\u439Fpf;\uC000\uD835\uDD46enCurly\u0100DQ\u0E0E\u0E1AoubleQuote;\u601Cuote;\u6018;\u6A54\u0100cl\u0E27\u0E2Cr;\uC000\uD835\uDCAAash\u803B\xD8\u40D8i\u016C\u0E37\u0E3Cde\u803B\xD5\u40D5es;\u6A37ml\u803B\xD6\u40D6er\u0100BP\u0E4B\u0E60\u0100ar\u0E50\u0E53r;\u603Eac\u0100ek\u0E5A\u0E5C;\u63DEet;\u63B4arenthesis;\u63DC\u0480acfhilors\u0E7F\u0E87\u0E8A\u0E8F\u0E92\u0E94\u0E9D\u0EB0\u0EFCrtialD;\u6202y;\u441Fr;\uC000\uD835\uDD13i;\u43A6;\u43A0usMinus;\u40B1\u0100ip\u0EA2\u0EADncareplan\xE5\u069Df;\u6119\u0200;eio\u0EB9\u0EBA\u0EE0\u0EE4\u6ABBcedes\u0200;EST\u0EC8\u0EC9\u0ECF\u0EDA\u627Aqual;\u6AAFlantEqual;\u627Cilde;\u627Eme;\u6033\u0100dp\u0EE9\u0EEEuct;\u620Fortion\u0100;a\u0225\u0EF9l;\u621D\u0100ci\u0F01\u0F06r;\uC000\uD835\uDCAB;\u43A8\u0200Ufos\u0F11\u0F16\u0F1B\u0F1FOT\u803B\"\u4022r;\uC000\uD835\uDD14pf;\u611Acr;\uC000\uD835\uDCAC\u0600BEacefhiorsu\u0F3E\u0F43\u0F47\u0F60\u0F73\u0FA7\u0FAA\u0FAD\u1096\u10A9\u10B4\u10BEarr;\u6910G\u803B\xAE\u40AE\u0180cnr\u0F4E\u0F53\u0F56ute;\u4154g;\u67EBr\u0100;t\u0F5C\u0F5D\u61A0l;\u6916\u0180aey\u0F67\u0F6C\u0F71ron;\u4158dil;\u4156;\u4420\u0100;v\u0F78\u0F79\u611Cerse\u0100EU\u0F82\u0F99\u0100lq\u0F87\u0F8Eement;\u620Builibrium;\u61CBpEquilibrium;\u696Fr\xBB\u0F79o;\u43A1ght\u0400ACDFTUVa\u0FC1\u0FEB\u0FF3\u1022\u1028\u105B\u1087\u03D8\u0100nr\u0FC6\u0FD2gleBracket;\u67E9row\u0180;BL\u0FDC\u0FDD\u0FE1\u6192ar;\u61E5eftArrow;\u61C4eiling;\u6309o\u01F5\u0FF9\x00\u1005bleBracket;\u67E7n\u01D4\u100A\x00\u1014eeVector;\u695Dector\u0100;B\u101D\u101E\u61C2ar;\u6955loor;\u630B\u0100er\u102D\u1043e\u0180;AV\u1035\u1036\u103C\u62A2rrow;\u61A6ector;\u695Biangle\u0180;BE\u1050\u1051\u1055\u62B3ar;\u69D0qual;\u62B5p\u0180DTV\u1063\u106E\u1078ownVector;\u694FeeVector;\u695Cector\u0100;B\u1082\u1083\u61BEar;\u6954ector\u0100;B\u1091\u1092\u61C0ar;\u6953\u0100pu\u109B\u109Ef;\u611DndImplies;\u6970ightarrow;\u61DB\u0100ch\u10B9\u10BCr;\u611B;\u61B1leDelayed;\u69F4\u0680HOacfhimoqstu\u10E4\u10F1\u10F7\u10FD\u1119\u111E\u1151\u1156\u1161\u1167\u11B5\u11BB\u11BF\u0100Cc\u10E9\u10EEHcy;\u4429y;\u4428FTcy;\u442Ccute;\u415A\u0280;aeiy\u1108\u1109\u110E\u1113\u1117\u6ABCron;\u4160dil;\u415Erc;\u415C;\u4421r;\uC000\uD835\uDD16ort\u0200DLRU\u112A\u1134\u113E\u1149ownArrow\xBB\u041EeftArrow\xBB\u089AightArrow\xBB\u0FDDpArrow;\u6191gma;\u43A3allCircle;\u6218pf;\uC000\uD835\uDD4A\u0272\u116D\x00\x00\u1170t;\u621Aare\u0200;ISU\u117B\u117C\u1189\u11AF\u65A1ntersection;\u6293u\u0100bp\u118F\u119Eset\u0100;E\u1197\u1198\u628Fqual;\u6291erset\u0100;E\u11A8\u11A9\u6290qual;\u6292nion;\u6294cr;\uC000\uD835\uDCAEar;\u62C6\u0200bcmp\u11C8\u11DB\u1209\u120B\u0100;s\u11CD\u11CE\u62D0et\u0100;E\u11CD\u11D5qual;\u6286\u0100ch\u11E0\u1205eeds\u0200;EST\u11ED\u11EE\u11F4\u11FF\u627Bqual;\u6AB0lantEqual;\u627Dilde;\u627FTh\xE1\u0F8C;\u6211\u0180;es\u1212\u1213\u1223\u62D1rset\u0100;E\u121C\u121D\u6283qual;\u6287et\xBB\u1213\u0580HRSacfhiors\u123E\u1244\u1249\u1255\u125E\u1271\u1276\u129F\u12C2\u12C8\u12D1ORN\u803B\xDE\u40DEADE;\u6122\u0100Hc\u124E\u1252cy;\u440By;\u4426\u0100bu\u125A\u125C;\u4009;\u43A4\u0180aey\u1265\u126A\u126Fron;\u4164dil;\u4162;\u4422r;\uC000\uD835\uDD17\u0100ei\u127B\u1289\u01F2\u1280\x00\u1287efore;\u6234a;\u4398\u0100cn\u128E\u1298kSpace;\uC000\u205F\u200ASpace;\u6009lde\u0200;EFT\u12AB\u12AC\u12B2\u12BC\u623Cqual;\u6243ullEqual;\u6245ilde;\u6248pf;\uC000\uD835\uDD4BipleDot;\u60DB\u0100ct\u12D6\u12DBr;\uC000\uD835\uDCAFrok;\u4166\u0AE1\u12F7\u130E\u131A\u1326\x00\u132C\u1331\x00\x00\x00\x00\x00\u1338\u133D\u1377\u1385\x00\u13FF\u1404\u140A\u1410\u0100cr\u12FB\u1301ute\u803B\xDA\u40DAr\u0100;o\u1307\u1308\u619Fcir;\u6949r\u01E3\u1313\x00\u1316y;\u440Eve;\u416C\u0100iy\u131E\u1323rc\u803B\xDB\u40DB;\u4423blac;\u4170r;\uC000\uD835\uDD18rave\u803B\xD9\u40D9acr;\u416A\u0100di\u1341\u1369er\u0100BP\u1348\u135D\u0100ar\u134D\u1350r;\u405Fac\u0100ek\u1357\u1359;\u63DFet;\u63B5arenthesis;\u63DDon\u0100;P\u1370\u1371\u62C3lus;\u628E\u0100gp\u137B\u137Fon;\u4172f;\uC000\uD835\uDD4C\u0400ADETadps\u1395\u13AE\u13B8\u13C4\u03E8\u13D2\u13D7\u13F3rrow\u0180;BD\u1150\u13A0\u13A4ar;\u6912ownArrow;\u61C5ownArrow;\u6195quilibrium;\u696Eee\u0100;A\u13CB\u13CC\u62A5rrow;\u61A5own\xE1\u03F3er\u0100LR\u13DE\u13E8eftArrow;\u6196ightArrow;\u6197i\u0100;l\u13F9\u13FA\u43D2on;\u43A5ing;\u416Ecr;\uC000\uD835\uDCB0ilde;\u4168ml\u803B\xDC\u40DC\u0480Dbcdefosv\u1427\u142C\u1430\u1433\u143E\u1485\u148A\u1490\u1496ash;\u62ABar;\u6AEBy;\u4412ash\u0100;l\u143B\u143C\u62A9;\u6AE6\u0100er\u1443\u1445;\u62C1\u0180bty\u144C\u1450\u147Aar;\u6016\u0100;i\u144F\u1455cal\u0200BLST\u1461\u1465\u146A\u1474ar;\u6223ine;\u407Ceparator;\u6758ilde;\u6240ThinSpace;\u600Ar;\uC000\uD835\uDD19pf;\uC000\uD835\uDD4Dcr;\uC000\uD835\uDCB1dash;\u62AA\u0280cefos\u14A7\u14AC\u14B1\u14B6\u14BCirc;\u4174dge;\u62C0r;\uC000\uD835\uDD1Apf;\uC000\uD835\uDD4Ecr;\uC000\uD835\uDCB2\u0200fios\u14CB\u14D0\u14D2\u14D8r;\uC000\uD835\uDD1B;\u439Epf;\uC000\uD835\uDD4Fcr;\uC000\uD835\uDCB3\u0480AIUacfosu\u14F1\u14F5\u14F9\u14FD\u1504\u150F\u1514\u151A\u1520cy;\u442Fcy;\u4407cy;\u442Ecute\u803B\xDD\u40DD\u0100iy\u1509\u150Drc;\u4176;\u442Br;\uC000\uD835\uDD1Cpf;\uC000\uD835\uDD50cr;\uC000\uD835\uDCB4ml;\u4178\u0400Hacdefos\u1535\u1539\u153F\u154B\u154F\u155D\u1560\u1564cy;\u4416cute;\u4179\u0100ay\u1544\u1549ron;\u417D;\u4417ot;\u417B\u01F2\u1554\x00\u155BoWidt\xE8\u0AD9a;\u4396r;\u6128pf;\u6124cr;\uC000\uD835\uDCB5\u0BE1\u1583\u158A\u1590\x00\u15B0\u15B6\u15BF\x00\x00\x00\x00\u15C6\u15DB\u15EB\u165F\u166D\x00\u1695\u169B\u16B2\u16B9\x00\u16BEcute\u803B\xE1\u40E1reve;\u4103\u0300;Ediuy\u159C\u159D\u15A1\u15A3\u15A8\u15AD\u623E;\uC000\u223E\u0333;\u623Frc\u803B\xE2\u40E2te\u80BB\xB4\u0306;\u4430lig\u803B\xE6\u40E6\u0100;r\xB2\u15BA;\uC000\uD835\uDD1Erave\u803B\xE0\u40E0\u0100ep\u15CA\u15D6\u0100fp\u15CF\u15D4sym;\u6135\xE8\u15D3ha;\u43B1\u0100ap\u15DFc\u0100cl\u15E4\u15E7r;\u4101g;\u6A3F\u0264\u15F0\x00\x00\u160A\u0280;adsv\u15FA\u15FB\u15FF\u1601\u1607\u6227nd;\u6A55;\u6A5Clope;\u6A58;\u6A5A\u0380;elmrsz\u1618\u1619\u161B\u161E\u163F\u164F\u1659\u6220;\u69A4e\xBB\u1619sd\u0100;a\u1625\u1626\u6221\u0461\u1630\u1632\u1634\u1636\u1638\u163A\u163C\u163E;\u69A8;\u69A9;\u69AA;\u69AB;\u69AC;\u69AD;\u69AE;\u69AFt\u0100;v\u1645\u1646\u621Fb\u0100;d\u164C\u164D\u62BE;\u699D\u0100pt\u1654\u1657h;\u6222\xBB\xB9arr;\u637C\u0100gp\u1663\u1667on;\u4105f;\uC000\uD835\uDD52\u0380;Eaeiop\u12C1\u167B\u167D\u1682\u1684\u1687\u168A;\u6A70cir;\u6A6F;\u624Ad;\u624Bs;\u4027rox\u0100;e\u12C1\u1692\xF1\u1683ing\u803B\xE5\u40E5\u0180cty\u16A1\u16A6\u16A8r;\uC000\uD835\uDCB6;\u402Amp\u0100;e\u12C1\u16AF\xF1\u0288ilde\u803B\xE3\u40E3ml\u803B\xE4\u40E4\u0100ci\u16C2\u16C8onin\xF4\u0272nt;\u6A11\u0800Nabcdefiklnoprsu\u16ED\u16F1\u1730\u173C\u1743\u1748\u1778\u177D\u17E0\u17E6\u1839\u1850\u170D\u193D\u1948\u1970ot;\u6AED\u0100cr\u16F6\u171Ek\u0200ceps\u1700\u1705\u170D\u1713ong;\u624Cpsilon;\u43F6rime;\u6035im\u0100;e\u171A\u171B\u623Dq;\u62CD\u0176\u1722\u1726ee;\u62BDed\u0100;g\u172C\u172D\u6305e\xBB\u172Drk\u0100;t\u135C\u1737brk;\u63B6\u0100oy\u1701\u1741;\u4431quo;\u601E\u0280cmprt\u1753\u175B\u1761\u1764\u1768aus\u0100;e\u010A\u0109ptyv;\u69B0s\xE9\u170Cno\xF5\u0113\u0180ahw\u176F\u1771\u1773;\u43B2;\u6136een;\u626Cr;\uC000\uD835\uDD1Fg\u0380costuvw\u178D\u179D\u17B3\u17C1\u17D5\u17DB\u17DE\u0180aiu\u1794\u1796\u179A\xF0\u0760rc;\u65EFp\xBB\u1371\u0180dpt\u17A4\u17A8\u17ADot;\u6A00lus;\u6A01imes;\u6A02\u0271\u17B9\x00\x00\u17BEcup;\u6A06ar;\u6605riangle\u0100du\u17CD\u17D2own;\u65BDp;\u65B3plus;\u6A04e\xE5\u1444\xE5\u14ADarow;\u690D\u0180ako\u17ED\u1826\u1835\u0100cn\u17F2\u1823k\u0180lst\u17FA\u05AB\u1802ozenge;\u69EBriangle\u0200;dlr\u1812\u1813\u1818\u181D\u65B4own;\u65BEeft;\u65C2ight;\u65B8k;\u6423\u01B1\u182B\x00\u1833\u01B2\u182F\x00\u1831;\u6592;\u65914;\u6593ck;\u6588\u0100eo\u183E\u184D\u0100;q\u1843\u1846\uC000=\u20E5uiv;\uC000\u2261\u20E5t;\u6310\u0200ptwx\u1859\u185E\u1867\u186Cf;\uC000\uD835\uDD53\u0100;t\u13CB\u1863om\xBB\u13CCtie;\u62C8\u0600DHUVbdhmptuv\u1885\u1896\u18AA\u18BB\u18D7\u18DB\u18EC\u18FF\u1905\u190A\u1910\u1921\u0200LRlr\u188E\u1890\u1892\u1894;\u6557;\u6554;\u6556;\u6553\u0280;DUdu\u18A1\u18A2\u18A4\u18A6\u18A8\u6550;\u6566;\u6569;\u6564;\u6567\u0200LRlr\u18B3\u18B5\u18B7\u18B9;\u655D;\u655A;\u655C;\u6559\u0380;HLRhlr\u18CA\u18CB\u18CD\u18CF\u18D1\u18D3\u18D5\u6551;\u656C;\u6563;\u6560;\u656B;\u6562;\u655Fox;\u69C9\u0200LRlr\u18E4\u18E6\u18E8\u18EA;\u6555;\u6552;\u6510;\u650C\u0280;DUdu\u06BD\u18F7\u18F9\u18FB\u18FD;\u6565;\u6568;\u652C;\u6534inus;\u629Flus;\u629Eimes;\u62A0\u0200LRlr\u1919\u191B\u191D\u191F;\u655B;\u6558;\u6518;\u6514\u0380;HLRhlr\u1930\u1931\u1933\u1935\u1937\u1939\u193B\u6502;\u656A;\u6561;\u655E;\u653C;\u6524;\u651C\u0100ev\u0123\u1942bar\u803B\xA6\u40A6\u0200ceio\u1951\u1956\u195A\u1960r;\uC000\uD835\uDCB7mi;\u604Fm\u0100;e\u171A\u171Cl\u0180;bh\u1968\u1969\u196B\u405C;\u69C5sub;\u67C8\u016C\u1974\u197El\u0100;e\u1979\u197A\u6022t\xBB\u197Ap\u0180;Ee\u012F\u1985\u1987;\u6AAE\u0100;q\u06DC\u06DB\u0CE1\u19A7\x00\u19E8\u1A11\u1A15\u1A32\x00\u1A37\u1A50\x00\x00\u1AB4\x00\x00\u1AC1\x00\x00\u1B21\u1B2E\u1B4D\u1B52\x00\u1BFD\x00\u1C0C\u0180cpr\u19AD\u19B2\u19DDute;\u4107\u0300;abcds\u19BF\u19C0\u19C4\u19CA\u19D5\u19D9\u6229nd;\u6A44rcup;\u6A49\u0100au\u19CF\u19D2p;\u6A4Bp;\u6A47ot;\u6A40;\uC000\u2229\uFE00\u0100eo\u19E2\u19E5t;\u6041\xEE\u0693\u0200aeiu\u19F0\u19FB\u1A01\u1A05\u01F0\u19F5\x00\u19F8s;\u6A4Don;\u410Ddil\u803B\xE7\u40E7rc;\u4109ps\u0100;s\u1A0C\u1A0D\u6A4Cm;\u6A50ot;\u410B\u0180dmn\u1A1B\u1A20\u1A26il\u80BB\xB8\u01ADptyv;\u69B2t\u8100\xA2;e\u1A2D\u1A2E\u40A2r\xE4\u01B2r;\uC000\uD835\uDD20\u0180cei\u1A3D\u1A40\u1A4Dy;\u4447ck\u0100;m\u1A47\u1A48\u6713ark\xBB\u1A48;\u43C7r\u0380;Ecefms\u1A5F\u1A60\u1A62\u1A6B\u1AA4\u1AAA\u1AAE\u65CB;\u69C3\u0180;el\u1A69\u1A6A\u1A6D\u42C6q;\u6257e\u0261\u1A74\x00\x00\u1A88rrow\u0100lr\u1A7C\u1A81eft;\u61BAight;\u61BB\u0280RSacd\u1A92\u1A94\u1A96\u1A9A\u1A9F\xBB\u0F47;\u64C8st;\u629Birc;\u629Aash;\u629Dnint;\u6A10id;\u6AEFcir;\u69C2ubs\u0100;u\u1ABB\u1ABC\u6663it\xBB\u1ABC\u02EC\u1AC7\u1AD4\u1AFA\x00\u1B0Aon\u0100;e\u1ACD\u1ACE\u403A\u0100;q\xC7\xC6\u026D\u1AD9\x00\x00\u1AE2a\u0100;t\u1ADE\u1ADF\u402C;\u4040\u0180;fl\u1AE8\u1AE9\u1AEB\u6201\xEE\u1160e\u0100mx\u1AF1\u1AF6ent\xBB\u1AE9e\xF3\u024D\u01E7\u1AFE\x00\u1B07\u0100;d\u12BB\u1B02ot;\u6A6Dn\xF4\u0246\u0180fry\u1B10\u1B14\u1B17;\uC000\uD835\uDD54o\xE4\u0254\u8100\xA9;s\u0155\u1B1Dr;\u6117\u0100ao\u1B25\u1B29rr;\u61B5ss;\u6717\u0100cu\u1B32\u1B37r;\uC000\uD835\uDCB8\u0100bp\u1B3C\u1B44\u0100;e\u1B41\u1B42\u6ACF;\u6AD1\u0100;e\u1B49\u1B4A\u6AD0;\u6AD2dot;\u62EF\u0380delprvw\u1B60\u1B6C\u1B77\u1B82\u1BAC\u1BD4\u1BF9arr\u0100lr\u1B68\u1B6A;\u6938;\u6935\u0270\u1B72\x00\x00\u1B75r;\u62DEc;\u62DFarr\u0100;p\u1B7F\u1B80\u61B6;\u693D\u0300;bcdos\u1B8F\u1B90\u1B96\u1BA1\u1BA5\u1BA8\u622Arcap;\u6A48\u0100au\u1B9B\u1B9Ep;\u6A46p;\u6A4Aot;\u628Dr;\u6A45;\uC000\u222A\uFE00\u0200alrv\u1BB5\u1BBF\u1BDE\u1BE3rr\u0100;m\u1BBC\u1BBD\u61B7;\u693Cy\u0180evw\u1BC7\u1BD4\u1BD8q\u0270\u1BCE\x00\x00\u1BD2re\xE3\u1B73u\xE3\u1B75ee;\u62CEedge;\u62CFen\u803B\xA4\u40A4earrow\u0100lr\u1BEE\u1BF3eft\xBB\u1B80ight\xBB\u1BBDe\xE4\u1BDD\u0100ci\u1C01\u1C07onin\xF4\u01F7nt;\u6231lcty;\u632D\u0980AHabcdefhijlorstuwz\u1C38\u1C3B\u1C3F\u1C5D\u1C69\u1C75\u1C8A\u1C9E\u1CAC\u1CB7\u1CFB\u1CFF\u1D0D\u1D7B\u1D91\u1DAB\u1DBB\u1DC6\u1DCDr\xF2\u0381ar;\u6965\u0200glrs\u1C48\u1C4D\u1C52\u1C54ger;\u6020eth;\u6138\xF2\u1133h\u0100;v\u1C5A\u1C5B\u6010\xBB\u090A\u016B\u1C61\u1C67arow;\u690Fa\xE3\u0315\u0100ay\u1C6E\u1C73ron;\u410F;\u4434\u0180;ao\u0332\u1C7C\u1C84\u0100gr\u02BF\u1C81r;\u61CAtseq;\u6A77\u0180glm\u1C91\u1C94\u1C98\u803B\xB0\u40B0ta;\u43B4ptyv;\u69B1\u0100ir\u1CA3\u1CA8sht;\u697F;\uC000\uD835\uDD21ar\u0100lr\u1CB3\u1CB5\xBB\u08DC\xBB\u101E\u0280aegsv\u1CC2\u0378\u1CD6\u1CDC\u1CE0m\u0180;os\u0326\u1CCA\u1CD4nd\u0100;s\u0326\u1CD1uit;\u6666amma;\u43DDin;\u62F2\u0180;io\u1CE7\u1CE8\u1CF8\u40F7de\u8100\xF7;o\u1CE7\u1CF0ntimes;\u62C7n\xF8\u1CF7cy;\u4452c\u026F\u1D06\x00\x00\u1D0Arn;\u631Eop;\u630D\u0280lptuw\u1D18\u1D1D\u1D22\u1D49\u1D55lar;\u4024f;\uC000\uD835\uDD55\u0280;emps\u030B\u1D2D\u1D37\u1D3D\u1D42q\u0100;d\u0352\u1D33ot;\u6251inus;\u6238lus;\u6214quare;\u62A1blebarwedg\xE5\xFAn\u0180adh\u112E\u1D5D\u1D67ownarrow\xF3\u1C83arpoon\u0100lr\u1D72\u1D76ef\xF4\u1CB4igh\xF4\u1CB6\u0162\u1D7F\u1D85karo\xF7\u0F42\u026F\u1D8A\x00\x00\u1D8Ern;\u631Fop;\u630C\u0180cot\u1D98\u1DA3\u1DA6\u0100ry\u1D9D\u1DA1;\uC000\uD835\uDCB9;\u4455l;\u69F6rok;\u4111\u0100dr\u1DB0\u1DB4ot;\u62F1i\u0100;f\u1DBA\u1816\u65BF\u0100ah\u1DC0\u1DC3r\xF2\u0429a\xF2\u0FA6angle;\u69A6\u0100ci\u1DD2\u1DD5y;\u445Fgrarr;\u67FF\u0900Dacdefglmnopqrstux\u1E01\u1E09\u1E19\u1E38\u0578\u1E3C\u1E49\u1E61\u1E7E\u1EA5\u1EAF\u1EBD\u1EE1\u1F2A\u1F37\u1F44\u1F4E\u1F5A\u0100Do\u1E06\u1D34o\xF4\u1C89\u0100cs\u1E0E\u1E14ute\u803B\xE9\u40E9ter;\u6A6E\u0200aioy\u1E22\u1E27\u1E31\u1E36ron;\u411Br\u0100;c\u1E2D\u1E2E\u6256\u803B\xEA\u40EAlon;\u6255;\u444Dot;\u4117\u0100Dr\u1E41\u1E45ot;\u6252;\uC000\uD835\uDD22\u0180;rs\u1E50\u1E51\u1E57\u6A9Aave\u803B\xE8\u40E8\u0100;d\u1E5C\u1E5D\u6A96ot;\u6A98\u0200;ils\u1E6A\u1E6B\u1E72\u1E74\u6A99nters;\u63E7;\u6113\u0100;d\u1E79\u1E7A\u6A95ot;\u6A97\u0180aps\u1E85\u1E89\u1E97cr;\u4113ty\u0180;sv\u1E92\u1E93\u1E95\u6205et\xBB\u1E93p\u01001;\u1E9D\u1EA4\u0133\u1EA1\u1EA3;\u6004;\u6005\u6003\u0100gs\u1EAA\u1EAC;\u414Bp;\u6002\u0100gp\u1EB4\u1EB8on;\u4119f;\uC000\uD835\uDD56\u0180als\u1EC4\u1ECE\u1ED2r\u0100;s\u1ECA\u1ECB\u62D5l;\u69E3us;\u6A71i\u0180;lv\u1EDA\u1EDB\u1EDF\u43B5on\xBB\u1EDB;\u43F5\u0200csuv\u1EEA\u1EF3\u1F0B\u1F23\u0100io\u1EEF\u1E31rc\xBB\u1E2E\u0269\u1EF9\x00\x00\u1EFB\xED\u0548ant\u0100gl\u1F02\u1F06tr\xBB\u1E5Dess\xBB\u1E7A\u0180aei\u1F12\u1F16\u1F1Als;\u403Dst;\u625Fv\u0100;D\u0235\u1F20D;\u6A78parsl;\u69E5\u0100Da\u1F2F\u1F33ot;\u6253rr;\u6971\u0180cdi\u1F3E\u1F41\u1EF8r;\u612Fo\xF4\u0352\u0100ah\u1F49\u1F4B;\u43B7\u803B\xF0\u40F0\u0100mr\u1F53\u1F57l\u803B\xEB\u40EBo;\u60AC\u0180cip\u1F61\u1F64\u1F67l;\u4021s\xF4\u056E\u0100eo\u1F6C\u1F74ctatio\xEE\u0559nential\xE5\u0579\u09E1\u1F92\x00\u1F9E\x00\u1FA1\u1FA7\x00\x00\u1FC6\u1FCC\x00\u1FD3\x00\u1FE6\u1FEA\u2000\x00\u2008\u205Allingdotse\xF1\u1E44y;\u4444male;\u6640\u0180ilr\u1FAD\u1FB3\u1FC1lig;\u8000\uFB03\u0269\u1FB9\x00\x00\u1FBDg;\u8000\uFB00ig;\u8000\uFB04;\uC000\uD835\uDD23lig;\u8000\uFB01lig;\uC000fj\u0180alt\u1FD9\u1FDC\u1FE1t;\u666Dig;\u8000\uFB02ns;\u65B1of;\u4192\u01F0\u1FEE\x00\u1FF3f;\uC000\uD835\uDD57\u0100ak\u05BF\u1FF7\u0100;v\u1FFC\u1FFD\u62D4;\u6AD9artint;\u6A0D\u0100ao\u200C\u2055\u0100cs\u2011\u2052\u03B1\u201A\u2030\u2038\u2045\u2048\x00\u2050\u03B2\u2022\u2025\u2027\u202A\u202C\x00\u202E\u803B\xBD\u40BD;\u6153\u803B\xBC\u40BC;\u6155;\u6159;\u615B\u01B3\u2034\x00\u2036;\u6154;\u6156\u02B4\u203E\u2041\x00\x00\u2043\u803B\xBE\u40BE;\u6157;\u615C5;\u6158\u01B6\u204C\x00\u204E;\u615A;\u615D8;\u615El;\u6044wn;\u6322cr;\uC000\uD835\uDCBB\u0880Eabcdefgijlnorstv\u2082\u2089\u209F\u20A5\u20B0\u20B4\u20F0\u20F5\u20FA\u20FF\u2103\u2112\u2138\u0317\u213E\u2152\u219E\u0100;l\u064D\u2087;\u6A8C\u0180cmp\u2090\u2095\u209Dute;\u41F5ma\u0100;d\u209C\u1CDA\u43B3;\u6A86reve;\u411F\u0100iy\u20AA\u20AErc;\u411D;\u4433ot;\u4121\u0200;lqs\u063E\u0642\u20BD\u20C9\u0180;qs\u063E\u064C\u20C4lan\xF4\u0665\u0200;cdl\u0665\u20D2\u20D5\u20E5c;\u6AA9ot\u0100;o\u20DC\u20DD\u6A80\u0100;l\u20E2\u20E3\u6A82;\u6A84\u0100;e\u20EA\u20ED\uC000\u22DB\uFE00s;\u6A94r;\uC000\uD835\uDD24\u0100;g\u0673\u061Bmel;\u6137cy;\u4453\u0200;Eaj\u065A\u210C\u210E\u2110;\u6A92;\u6AA5;\u6AA4\u0200Eaes\u211B\u211D\u2129\u2134;\u6269p\u0100;p\u2123\u2124\u6A8Arox\xBB\u2124\u0100;q\u212E\u212F\u6A88\u0100;q\u212E\u211Bim;\u62E7pf;\uC000\uD835\uDD58\u0100ci\u2143\u2146r;\u610Am\u0180;el\u066B\u214E\u2150;\u6A8E;\u6A90\u8300>;cdlqr\u05EE\u2160\u216A\u216E\u2173\u2179\u0100ci\u2165\u2167;\u6AA7r;\u6A7Aot;\u62D7Par;\u6995uest;\u6A7C\u0280adels\u2184\u216A\u2190\u0656\u219B\u01F0\u2189\x00\u218Epro\xF8\u209Er;\u6978q\u0100lq\u063F\u2196les\xF3\u2088i\xED\u066B\u0100en\u21A3\u21ADrtneqq;\uC000\u2269\uFE00\xC5\u21AA\u0500Aabcefkosy\u21C4\u21C7\u21F1\u21F5\u21FA\u2218\u221D\u222F\u2268\u227Dr\xF2\u03A0\u0200ilmr\u21D0\u21D4\u21D7\u21DBrs\xF0\u1484f\xBB\u2024il\xF4\u06A9\u0100dr\u21E0\u21E4cy;\u444A\u0180;cw\u08F4\u21EB\u21EFir;\u6948;\u61ADar;\u610Firc;\u4125\u0180alr\u2201\u220E\u2213rts\u0100;u\u2209\u220A\u6665it\xBB\u220Alip;\u6026con;\u62B9r;\uC000\uD835\uDD25s\u0100ew\u2223\u2229arow;\u6925arow;\u6926\u0280amopr\u223A\u223E\u2243\u225E\u2263rr;\u61FFtht;\u623Bk\u0100lr\u2249\u2253eftarrow;\u61A9ightarrow;\u61AAf;\uC000\uD835\uDD59bar;\u6015\u0180clt\u226F\u2274\u2278r;\uC000\uD835\uDCBDas\xE8\u21F4rok;\u4127\u0100bp\u2282\u2287ull;\u6043hen\xBB\u1C5B\u0AE1\u22A3\x00\u22AA\x00\u22B8\u22C5\u22CE\x00\u22D5\u22F3\x00\x00\u22F8\u2322\u2367\u2362\u237F\x00\u2386\u23AA\u23B4cute\u803B\xED\u40ED\u0180;iy\u0771\u22B0\u22B5rc\u803B\xEE\u40EE;\u4438\u0100cx\u22BC\u22BFy;\u4435cl\u803B\xA1\u40A1\u0100fr\u039F\u22C9;\uC000\uD835\uDD26rave\u803B\xEC\u40EC\u0200;ino\u073E\u22DD\u22E9\u22EE\u0100in\u22E2\u22E6nt;\u6A0Ct;\u622Dfin;\u69DCta;\u6129lig;\u4133\u0180aop\u22FE\u231A\u231D\u0180cgt\u2305\u2308\u2317r;\u412B\u0180elp\u071F\u230F\u2313in\xE5\u078Ear\xF4\u0720h;\u4131f;\u62B7ed;\u41B5\u0280;cfot\u04F4\u232C\u2331\u233D\u2341are;\u6105in\u0100;t\u2338\u2339\u621Eie;\u69DDdo\xF4\u2319\u0280;celp\u0757\u234C\u2350\u235B\u2361al;\u62BA\u0100gr\u2355\u2359er\xF3\u1563\xE3\u234Darhk;\u6A17rod;\u6A3C\u0200cgpt\u236F\u2372\u2376\u237By;\u4451on;\u412Ff;\uC000\uD835\uDD5Aa;\u43B9uest\u803B\xBF\u40BF\u0100ci\u238A\u238Fr;\uC000\uD835\uDCBEn\u0280;Edsv\u04F4\u239B\u239D\u23A1\u04F3;\u62F9ot;\u62F5\u0100;v\u23A6\u23A7\u62F4;\u62F3\u0100;i\u0777\u23AElde;\u4129\u01EB\u23B8\x00\u23BCcy;\u4456l\u803B\xEF\u40EF\u0300cfmosu\u23CC\u23D7\u23DC\u23E1\u23E7\u23F5\u0100iy\u23D1\u23D5rc;\u4135;\u4439r;\uC000\uD835\uDD27ath;\u4237pf;\uC000\uD835\uDD5B\u01E3\u23EC\x00\u23F1r;\uC000\uD835\uDCBFrcy;\u4458kcy;\u4454\u0400acfghjos\u240B\u2416\u2422\u2427\u242D\u2431\u2435\u243Bppa\u0100;v\u2413\u2414\u43BA;\u43F0\u0100ey\u241B\u2420dil;\u4137;\u443Ar;\uC000\uD835\uDD28reen;\u4138cy;\u4445cy;\u445Cpf;\uC000\uD835\uDD5Ccr;\uC000\uD835\uDCC0\u0B80ABEHabcdefghjlmnoprstuv\u2470\u2481\u2486\u248D\u2491\u250E\u253D\u255A\u2580\u264E\u265E\u2665\u2679\u267D\u269A\u26B2\u26D8\u275D\u2768\u278B\u27C0\u2801\u2812\u0180art\u2477\u247A\u247Cr\xF2\u09C6\xF2\u0395ail;\u691Barr;\u690E\u0100;g\u0994\u248B;\u6A8Bar;\u6962\u0963\u24A5\x00\u24AA\x00\u24B1\x00\x00\x00\x00\x00\u24B5\u24BA\x00\u24C6\u24C8\u24CD\x00\u24F9ute;\u413Amptyv;\u69B4ra\xEE\u084Cbda;\u43BBg\u0180;dl\u088E\u24C1\u24C3;\u6991\xE5\u088E;\u6A85uo\u803B\xAB\u40ABr\u0400;bfhlpst\u0899\u24DE\u24E6\u24E9\u24EB\u24EE\u24F1\u24F5\u0100;f\u089D\u24E3s;\u691Fs;\u691D\xEB\u2252p;\u61ABl;\u6939im;\u6973l;\u61A2\u0180;ae\u24FF\u2500\u2504\u6AABil;\u6919\u0100;s\u2509\u250A\u6AAD;\uC000\u2AAD\uFE00\u0180abr\u2515\u2519\u251Drr;\u690Crk;\u6772\u0100ak\u2522\u252Cc\u0100ek\u2528\u252A;\u407B;\u405B\u0100es\u2531\u2533;\u698Bl\u0100du\u2539\u253B;\u698F;\u698D\u0200aeuy\u2546\u254B\u2556\u2558ron;\u413E\u0100di\u2550\u2554il;\u413C\xEC\u08B0\xE2\u2529;\u443B\u0200cqrs\u2563\u2566\u256D\u257Da;\u6936uo\u0100;r\u0E19\u1746\u0100du\u2572\u2577har;\u6967shar;\u694Bh;\u61B2\u0280;fgqs\u258B\u258C\u0989\u25F3\u25FF\u6264t\u0280ahlrt\u2598\u25A4\u25B7\u25C2\u25E8rrow\u0100;t\u0899\u25A1a\xE9\u24F6arpoon\u0100du\u25AF\u25B4own\xBB\u045Ap\xBB\u0966eftarrows;\u61C7ight\u0180ahs\u25CD\u25D6\u25DErrow\u0100;s\u08F4\u08A7arpoon\xF3\u0F98quigarro\xF7\u21F0hreetimes;\u62CB\u0180;qs\u258B\u0993\u25FAlan\xF4\u09AC\u0280;cdgs\u09AC\u260A\u260D\u261D\u2628c;\u6AA8ot\u0100;o\u2614\u2615\u6A7F\u0100;r\u261A\u261B\u6A81;\u6A83\u0100;e\u2622\u2625\uC000\u22DA\uFE00s;\u6A93\u0280adegs\u2633\u2639\u263D\u2649\u264Bppro\xF8\u24C6ot;\u62D6q\u0100gq\u2643\u2645\xF4\u0989gt\xF2\u248C\xF4\u099Bi\xED\u09B2\u0180ilr\u2655\u08E1\u265Asht;\u697C;\uC000\uD835\uDD29\u0100;E\u099C\u2663;\u6A91\u0161\u2669\u2676r\u0100du\u25B2\u266E\u0100;l\u0965\u2673;\u696Alk;\u6584cy;\u4459\u0280;acht\u0A48\u2688\u268B\u2691\u2696r\xF2\u25C1orne\xF2\u1D08ard;\u696Bri;\u65FA\u0100io\u269F\u26A4dot;\u4140ust\u0100;a\u26AC\u26AD\u63B0che\xBB\u26AD\u0200Eaes\u26BB\u26BD\u26C9\u26D4;\u6268p\u0100;p\u26C3\u26C4\u6A89rox\xBB\u26C4\u0100;q\u26CE\u26CF\u6A87\u0100;q\u26CE\u26BBim;\u62E6\u0400abnoptwz\u26E9\u26F4\u26F7\u271A\u272F\u2741\u2747\u2750\u0100nr\u26EE\u26F1g;\u67ECr;\u61FDr\xEB\u08C1g\u0180lmr\u26FF\u270D\u2714eft\u0100ar\u09E6\u2707ight\xE1\u09F2apsto;\u67FCight\xE1\u09FDparrow\u0100lr\u2725\u2729ef\xF4\u24EDight;\u61AC\u0180afl\u2736\u2739\u273Dr;\u6985;\uC000\uD835\uDD5Dus;\u6A2Dimes;\u6A34\u0161\u274B\u274Fst;\u6217\xE1\u134E\u0180;ef\u2757\u2758\u1800\u65CAnge\xBB\u2758ar\u0100;l\u2764\u2765\u4028t;\u6993\u0280achmt\u2773\u2776\u277C\u2785\u2787r\xF2\u08A8orne\xF2\u1D8Car\u0100;d\u0F98\u2783;\u696D;\u600Eri;\u62BF\u0300achiqt\u2798\u279D\u0A40\u27A2\u27AE\u27BBquo;\u6039r;\uC000\uD835\uDCC1m\u0180;eg\u09B2\u27AA\u27AC;\u6A8D;\u6A8F\u0100bu\u252A\u27B3o\u0100;r\u0E1F\u27B9;\u601Arok;\u4142\u8400<;cdhilqr\u082B\u27D2\u2639\u27DC\u27E0\u27E5\u27EA\u27F0\u0100ci\u27D7\u27D9;\u6AA6r;\u6A79re\xE5\u25F2mes;\u62C9arr;\u6976uest;\u6A7B\u0100Pi\u27F5\u27F9ar;\u6996\u0180;ef\u2800\u092D\u181B\u65C3r\u0100du\u2807\u280Dshar;\u694Ahar;\u6966\u0100en\u2817\u2821rtneqq;\uC000\u2268\uFE00\xC5\u281E\u0700Dacdefhilnopsu\u2840\u2845\u2882\u288E\u2893\u28A0\u28A5\u28A8\u28DA\u28E2\u28E4\u0A83\u28F3\u2902Dot;\u623A\u0200clpr\u284E\u2852\u2863\u287Dr\u803B\xAF\u40AF\u0100et\u2857\u2859;\u6642\u0100;e\u285E\u285F\u6720se\xBB\u285F\u0100;s\u103B\u2868to\u0200;dlu\u103B\u2873\u2877\u287Bow\xEE\u048Cef\xF4\u090F\xF0\u13D1ker;\u65AE\u0100oy\u2887\u288Cmma;\u6A29;\u443Cash;\u6014asuredangle\xBB\u1626r;\uC000\uD835\uDD2Ao;\u6127\u0180cdn\u28AF\u28B4\u28C9ro\u803B\xB5\u40B5\u0200;acd\u1464\u28BD\u28C0\u28C4s\xF4\u16A7ir;\u6AF0ot\u80BB\xB7\u01B5us\u0180;bd\u28D2\u1903\u28D3\u6212\u0100;u\u1D3C\u28D8;\u6A2A\u0163\u28DE\u28E1p;\u6ADB\xF2\u2212\xF0\u0A81\u0100dp\u28E9\u28EEels;\u62A7f;\uC000\uD835\uDD5E\u0100ct\u28F8\u28FDr;\uC000\uD835\uDCC2pos\xBB\u159D\u0180;lm\u2909\u290A\u290D\u43BCtimap;\u62B8\u0C00GLRVabcdefghijlmoprstuvw\u2942\u2953\u297E\u2989\u2998\u29DA\u29E9\u2A15\u2A1A\u2A58\u2A5D\u2A83\u2A95\u2AA4\u2AA8\u2B04\u2B07\u2B44\u2B7F\u2BAE\u2C34\u2C67\u2C7C\u2CE9\u0100gt\u2947\u294B;\uC000\u22D9\u0338\u0100;v\u2950\u0BCF\uC000\u226B\u20D2\u0180elt\u295A\u2972\u2976ft\u0100ar\u2961\u2967rrow;\u61CDightarrow;\u61CE;\uC000\u22D8\u0338\u0100;v\u297B\u0C47\uC000\u226A\u20D2ightarrow;\u61CF\u0100Dd\u298E\u2993ash;\u62AFash;\u62AE\u0280bcnpt\u29A3\u29A7\u29AC\u29B1\u29CCla\xBB\u02DEute;\u4144g;\uC000\u2220\u20D2\u0280;Eiop\u0D84\u29BC\u29C0\u29C5\u29C8;\uC000\u2A70\u0338d;\uC000\u224B\u0338s;\u4149ro\xF8\u0D84ur\u0100;a\u29D3\u29D4\u666El\u0100;s\u29D3\u0B38\u01F3\u29DF\x00\u29E3p\u80BB\xA0\u0B37mp\u0100;e\u0BF9\u0C00\u0280aeouy\u29F4\u29FE\u2A03\u2A10\u2A13\u01F0\u29F9\x00\u29FB;\u6A43on;\u4148dil;\u4146ng\u0100;d\u0D7E\u2A0Aot;\uC000\u2A6D\u0338p;\u6A42;\u443Dash;\u6013\u0380;Aadqsx\u0B92\u2A29\u2A2D\u2A3B\u2A41\u2A45\u2A50rr;\u61D7r\u0100hr\u2A33\u2A36k;\u6924\u0100;o\u13F2\u13F0ot;\uC000\u2250\u0338ui\xF6\u0B63\u0100ei\u2A4A\u2A4Ear;\u6928\xED\u0B98ist\u0100;s\u0BA0\u0B9Fr;\uC000\uD835\uDD2B\u0200Eest\u0BC5\u2A66\u2A79\u2A7C\u0180;qs\u0BBC\u2A6D\u0BE1\u0180;qs\u0BBC\u0BC5\u2A74lan\xF4\u0BE2i\xED\u0BEA\u0100;r\u0BB6\u2A81\xBB\u0BB7\u0180Aap\u2A8A\u2A8D\u2A91r\xF2\u2971rr;\u61AEar;\u6AF2\u0180;sv\u0F8D\u2A9C\u0F8C\u0100;d\u2AA1\u2AA2\u62FC;\u62FAcy;\u445A\u0380AEadest\u2AB7\u2ABA\u2ABE\u2AC2\u2AC5\u2AF6\u2AF9r\xF2\u2966;\uC000\u2266\u0338rr;\u619Ar;\u6025\u0200;fqs\u0C3B\u2ACE\u2AE3\u2AEFt\u0100ar\u2AD4\u2AD9rro\xF7\u2AC1ightarro\xF7\u2A90\u0180;qs\u0C3B\u2ABA\u2AEAlan\xF4\u0C55\u0100;s\u0C55\u2AF4\xBB\u0C36i\xED\u0C5D\u0100;r\u0C35\u2AFEi\u0100;e\u0C1A\u0C25i\xE4\u0D90\u0100pt\u2B0C\u2B11f;\uC000\uD835\uDD5F\u8180\xAC;in\u2B19\u2B1A\u2B36\u40ACn\u0200;Edv\u0B89\u2B24\u2B28\u2B2E;\uC000\u22F9\u0338ot;\uC000\u22F5\u0338\u01E1\u0B89\u2B33\u2B35;\u62F7;\u62F6i\u0100;v\u0CB8\u2B3C\u01E1\u0CB8\u2B41\u2B43;\u62FE;\u62FD\u0180aor\u2B4B\u2B63\u2B69r\u0200;ast\u0B7B\u2B55\u2B5A\u2B5Flle\xEC\u0B7Bl;\uC000\u2AFD\u20E5;\uC000\u2202\u0338lint;\u6A14\u0180;ce\u0C92\u2B70\u2B73u\xE5\u0CA5\u0100;c\u0C98\u2B78\u0100;e\u0C92\u2B7D\xF1\u0C98\u0200Aait\u2B88\u2B8B\u2B9D\u2BA7r\xF2\u2988rr\u0180;cw\u2B94\u2B95\u2B99\u619B;\uC000\u2933\u0338;\uC000\u219D\u0338ghtarrow\xBB\u2B95ri\u0100;e\u0CCB\u0CD6\u0380chimpqu\u2BBD\u2BCD\u2BD9\u2B04\u0B78\u2BE4\u2BEF\u0200;cer\u0D32\u2BC6\u0D37\u2BC9u\xE5\u0D45;\uC000\uD835\uDCC3ort\u026D\u2B05\x00\x00\u2BD6ar\xE1\u2B56m\u0100;e\u0D6E\u2BDF\u0100;q\u0D74\u0D73su\u0100bp\u2BEB\u2BED\xE5\u0CF8\xE5\u0D0B\u0180bcp\u2BF6\u2C11\u2C19\u0200;Ees\u2BFF\u2C00\u0D22\u2C04\u6284;\uC000\u2AC5\u0338et\u0100;e\u0D1B\u2C0Bq\u0100;q\u0D23\u2C00c\u0100;e\u0D32\u2C17\xF1\u0D38\u0200;Ees\u2C22\u2C23\u0D5F\u2C27\u6285;\uC000\u2AC6\u0338et\u0100;e\u0D58\u2C2Eq\u0100;q\u0D60\u2C23\u0200gilr\u2C3D\u2C3F\u2C45\u2C47\xEC\u0BD7lde\u803B\xF1\u40F1\xE7\u0C43iangle\u0100lr\u2C52\u2C5Ceft\u0100;e\u0C1A\u2C5A\xF1\u0C26ight\u0100;e\u0CCB\u2C65\xF1\u0CD7\u0100;m\u2C6C\u2C6D\u43BD\u0180;es\u2C74\u2C75\u2C79\u4023ro;\u6116p;\u6007\u0480DHadgilrs\u2C8F\u2C94\u2C99\u2C9E\u2CA3\u2CB0\u2CB6\u2CD3\u2CE3ash;\u62ADarr;\u6904p;\uC000\u224D\u20D2ash;\u62AC\u0100et\u2CA8\u2CAC;\uC000\u2265\u20D2;\uC000>\u20D2nfin;\u69DE\u0180Aet\u2CBD\u2CC1\u2CC5rr;\u6902;\uC000\u2264\u20D2\u0100;r\u2CCA\u2CCD\uC000<\u20D2ie;\uC000\u22B4\u20D2\u0100At\u2CD8\u2CDCrr;\u6903rie;\uC000\u22B5\u20D2im;\uC000\u223C\u20D2\u0180Aan\u2CF0\u2CF4\u2D02rr;\u61D6r\u0100hr\u2CFA\u2CFDk;\u6923\u0100;o\u13E7\u13E5ear;\u6927\u1253\u1A95\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\u2D2D\x00\u2D38\u2D48\u2D60\u2D65\u2D72\u2D84\u1B07\x00\x00\u2D8D\u2DAB\x00\u2DC8\u2DCE\x00\u2DDC\u2E19\u2E2B\u2E3E\u2E43\u0100cs\u2D31\u1A97ute\u803B\xF3\u40F3\u0100iy\u2D3C\u2D45r\u0100;c\u1A9E\u2D42\u803B\xF4\u40F4;\u443E\u0280abios\u1AA0\u2D52\u2D57\u01C8\u2D5Alac;\u4151v;\u6A38old;\u69BClig;\u4153\u0100cr\u2D69\u2D6Dir;\u69BF;\uC000\uD835\uDD2C\u036F\u2D79\x00\x00\u2D7C\x00\u2D82n;\u42DBave\u803B\xF2\u40F2;\u69C1\u0100bm\u2D88\u0DF4ar;\u69B5\u0200acit\u2D95\u2D98\u2DA5\u2DA8r\xF2\u1A80\u0100ir\u2D9D\u2DA0r;\u69BEoss;\u69BBn\xE5\u0E52;\u69C0\u0180aei\u2DB1\u2DB5\u2DB9cr;\u414Dga;\u43C9\u0180cdn\u2DC0\u2DC5\u01CDron;\u43BF;\u69B6pf;\uC000\uD835\uDD60\u0180ael\u2DD4\u2DD7\u01D2r;\u69B7rp;\u69B9\u0380;adiosv\u2DEA\u2DEB\u2DEE\u2E08\u2E0D\u2E10\u2E16\u6228r\xF2\u1A86\u0200;efm\u2DF7\u2DF8\u2E02\u2E05\u6A5Dr\u0100;o\u2DFE\u2DFF\u6134f\xBB\u2DFF\u803B\xAA\u40AA\u803B\xBA\u40BAgof;\u62B6r;\u6A56lope;\u6A57;\u6A5B\u0180clo\u2E1F\u2E21\u2E27\xF2\u2E01ash\u803B\xF8\u40F8l;\u6298i\u016C\u2E2F\u2E34de\u803B\xF5\u40F5es\u0100;a\u01DB\u2E3As;\u6A36ml\u803B\xF6\u40F6bar;\u633D\u0AE1\u2E5E\x00\u2E7D\x00\u2E80\u2E9D\x00\u2EA2\u2EB9\x00\x00\u2ECB\u0E9C\x00\u2F13\x00\x00\u2F2B\u2FBC\x00\u2FC8r\u0200;ast\u0403\u2E67\u2E72\u0E85\u8100\xB6;l\u2E6D\u2E6E\u40B6le\xEC\u0403\u0269\u2E78\x00\x00\u2E7Bm;\u6AF3;\u6AFDy;\u443Fr\u0280cimpt\u2E8B\u2E8F\u2E93\u1865\u2E97nt;\u4025od;\u402Eil;\u6030enk;\u6031r;\uC000\uD835\uDD2D\u0180imo\u2EA8\u2EB0\u2EB4\u0100;v\u2EAD\u2EAE\u43C6;\u43D5ma\xF4\u0A76ne;\u660E\u0180;tv\u2EBF\u2EC0\u2EC8\u43C0chfork\xBB\u1FFD;\u43D6\u0100au\u2ECF\u2EDFn\u0100ck\u2ED5\u2EDDk\u0100;h\u21F4\u2EDB;\u610E\xF6\u21F4s\u0480;abcdemst\u2EF3\u2EF4\u1908\u2EF9\u2EFD\u2F04\u2F06\u2F0A\u2F0E\u402Bcir;\u6A23ir;\u6A22\u0100ou\u1D40\u2F02;\u6A25;\u6A72n\u80BB\xB1\u0E9Dim;\u6A26wo;\u6A27\u0180ipu\u2F19\u2F20\u2F25ntint;\u6A15f;\uC000\uD835\uDD61nd\u803B\xA3\u40A3\u0500;Eaceinosu\u0EC8\u2F3F\u2F41\u2F44\u2F47\u2F81\u2F89\u2F92\u2F7E\u2FB6;\u6AB3p;\u6AB7u\xE5\u0ED9\u0100;c\u0ECE\u2F4C\u0300;acens\u0EC8\u2F59\u2F5F\u2F66\u2F68\u2F7Eppro\xF8\u2F43urlye\xF1\u0ED9\xF1\u0ECE\u0180aes\u2F6F\u2F76\u2F7Approx;\u6AB9qq;\u6AB5im;\u62E8i\xED\u0EDFme\u0100;s\u2F88\u0EAE\u6032\u0180Eas\u2F78\u2F90\u2F7A\xF0\u2F75\u0180dfp\u0EEC\u2F99\u2FAF\u0180als\u2FA0\u2FA5\u2FAAlar;\u632Eine;\u6312urf;\u6313\u0100;t\u0EFB\u2FB4\xEF\u0EFBrel;\u62B0\u0100ci\u2FC0\u2FC5r;\uC000\uD835\uDCC5;\u43C8ncsp;\u6008\u0300fiopsu\u2FDA\u22E2\u2FDF\u2FE5\u2FEB\u2FF1r;\uC000\uD835\uDD2Epf;\uC000\uD835\uDD62rime;\u6057cr;\uC000\uD835\uDCC6\u0180aeo\u2FF8\u3009\u3013t\u0100ei\u2FFE\u3005rnion\xF3\u06B0nt;\u6A16st\u0100;e\u3010\u3011\u403F\xF1\u1F19\xF4\u0F14\u0A80ABHabcdefhilmnoprstux\u3040\u3051\u3055\u3059\u30E0\u310E\u312B\u3147\u3162\u3172\u318E\u3206\u3215\u3224\u3229\u3258\u326E\u3272\u3290\u32B0\u32B7\u0180art\u3047\u304A\u304Cr\xF2\u10B3\xF2\u03DDail;\u691Car\xF2\u1C65ar;\u6964\u0380cdenqrt\u3068\u3075\u3078\u307F\u308F\u3094\u30CC\u0100eu\u306D\u3071;\uC000\u223D\u0331te;\u4155i\xE3\u116Emptyv;\u69B3g\u0200;del\u0FD1\u3089\u308B\u308D;\u6992;\u69A5\xE5\u0FD1uo\u803B\xBB\u40BBr\u0580;abcfhlpstw\u0FDC\u30AC\u30AF\u30B7\u30B9\u30BC\u30BE\u30C0\u30C3\u30C7\u30CAp;\u6975\u0100;f\u0FE0\u30B4s;\u6920;\u6933s;\u691E\xEB\u225D\xF0\u272El;\u6945im;\u6974l;\u61A3;\u619D\u0100ai\u30D1\u30D5il;\u691Ao\u0100;n\u30DB\u30DC\u6236al\xF3\u0F1E\u0180abr\u30E7\u30EA\u30EEr\xF2\u17E5rk;\u6773\u0100ak\u30F3\u30FDc\u0100ek\u30F9\u30FB;\u407D;\u405D\u0100es\u3102\u3104;\u698Cl\u0100du\u310A\u310C;\u698E;\u6990\u0200aeuy\u3117\u311C\u3127\u3129ron;\u4159\u0100di\u3121\u3125il;\u4157\xEC\u0FF2\xE2\u30FA;\u4440\u0200clqs\u3134\u3137\u313D\u3144a;\u6937dhar;\u6969uo\u0100;r\u020E\u020Dh;\u61B3\u0180acg\u314E\u315F\u0F44l\u0200;ips\u0F78\u3158\u315B\u109Cn\xE5\u10BBar\xF4\u0FA9t;\u65AD\u0180ilr\u3169\u1023\u316Esht;\u697D;\uC000\uD835\uDD2F\u0100ao\u3177\u3186r\u0100du\u317D\u317F\xBB\u047B\u0100;l\u1091\u3184;\u696C\u0100;v\u318B\u318C\u43C1;\u43F1\u0180gns\u3195\u31F9\u31FCht\u0300ahlrst\u31A4\u31B0\u31C2\u31D8\u31E4\u31EErrow\u0100;t\u0FDC\u31ADa\xE9\u30C8arpoon\u0100du\u31BB\u31BFow\xEE\u317Ep\xBB\u1092eft\u0100ah\u31CA\u31D0rrow\xF3\u0FEAarpoon\xF3\u0551ightarrows;\u61C9quigarro\xF7\u30CBhreetimes;\u62CCg;\u42DAingdotse\xF1\u1F32\u0180ahm\u320D\u3210\u3213r\xF2\u0FEAa\xF2\u0551;\u600Foust\u0100;a\u321E\u321F\u63B1che\xBB\u321Fmid;\u6AEE\u0200abpt\u3232\u323D\u3240\u3252\u0100nr\u3237\u323Ag;\u67EDr;\u61FEr\xEB\u1003\u0180afl\u3247\u324A\u324Er;\u6986;\uC000\uD835\uDD63us;\u6A2Eimes;\u6A35\u0100ap\u325D\u3267r\u0100;g\u3263\u3264\u4029t;\u6994olint;\u6A12ar\xF2\u31E3\u0200achq\u327B\u3280\u10BC\u3285quo;\u603Ar;\uC000\uD835\uDCC7\u0100bu\u30FB\u328Ao\u0100;r\u0214\u0213\u0180hir\u3297\u329B\u32A0re\xE5\u31F8mes;\u62CAi\u0200;efl\u32AA\u1059\u1821\u32AB\u65B9tri;\u69CEluhar;\u6968;\u611E\u0D61\u32D5\u32DB\u32DF\u332C\u3338\u3371\x00\u337A\u33A4\x00\x00\u33EC\u33F0\x00\u3428\u3448\u345A\u34AD\u34B1\u34CA\u34F1\x00\u3616\x00\x00\u3633cute;\u415Bqu\xEF\u27BA\u0500;Eaceinpsy\u11ED\u32F3\u32F5\u32FF\u3302\u330B\u330F\u331F\u3326\u3329;\u6AB4\u01F0\u32FA\x00\u32FC;\u6AB8on;\u4161u\xE5\u11FE\u0100;d\u11F3\u3307il;\u415Frc;\u415D\u0180Eas\u3316\u3318\u331B;\u6AB6p;\u6ABAim;\u62E9olint;\u6A13i\xED\u1204;\u4441ot\u0180;be\u3334\u1D47\u3335\u62C5;\u6A66\u0380Aacmstx\u3346\u334A\u3357\u335B\u335E\u3363\u336Drr;\u61D8r\u0100hr\u3350\u3352\xEB\u2228\u0100;o\u0A36\u0A34t\u803B\xA7\u40A7i;\u403Bwar;\u6929m\u0100in\u3369\xF0nu\xF3\xF1t;\u6736r\u0100;o\u3376\u2055\uC000\uD835\uDD30\u0200acoy\u3382\u3386\u3391\u33A0rp;\u666F\u0100hy\u338B\u338Fcy;\u4449;\u4448rt\u026D\u3399\x00\x00\u339Ci\xE4\u1464ara\xEC\u2E6F\u803B\xAD\u40AD\u0100gm\u33A8\u33B4ma\u0180;fv\u33B1\u33B2\u33B2\u43C3;\u43C2\u0400;deglnpr\u12AB\u33C5\u33C9\u33CE\u33D6\u33DE\u33E1\u33E6ot;\u6A6A\u0100;q\u12B1\u12B0\u0100;E\u33D3\u33D4\u6A9E;\u6AA0\u0100;E\u33DB\u33DC\u6A9D;\u6A9Fe;\u6246lus;\u6A24arr;\u6972ar\xF2\u113D\u0200aeit\u33F8\u3408\u340F\u3417\u0100ls\u33FD\u3404lsetm\xE9\u336Ahp;\u6A33parsl;\u69E4\u0100dl\u1463\u3414e;\u6323\u0100;e\u341C\u341D\u6AAA\u0100;s\u3422\u3423\u6AAC;\uC000\u2AAC\uFE00\u0180flp\u342E\u3433\u3442tcy;\u444C\u0100;b\u3438\u3439\u402F\u0100;a\u343E\u343F\u69C4r;\u633Ff;\uC000\uD835\uDD64a\u0100dr\u344D\u0402es\u0100;u\u3454\u3455\u6660it\xBB\u3455\u0180csu\u3460\u3479\u349F\u0100au\u3465\u346Fp\u0100;s\u1188\u346B;\uC000\u2293\uFE00p\u0100;s\u11B4\u3475;\uC000\u2294\uFE00u\u0100bp\u347F\u348F\u0180;es\u1197\u119C\u3486et\u0100;e\u1197\u348D\xF1\u119D\u0180;es\u11A8\u11AD\u3496et\u0100;e\u11A8\u349D\xF1\u11AE\u0180;af\u117B\u34A6\u05B0r\u0165\u34AB\u05B1\xBB\u117Car\xF2\u1148\u0200cemt\u34B9\u34BE\u34C2\u34C5r;\uC000\uD835\uDCC8tm\xEE\xF1i\xEC\u3415ar\xE6\u11BE\u0100ar\u34CE\u34D5r\u0100;f\u34D4\u17BF\u6606\u0100an\u34DA\u34EDight\u0100ep\u34E3\u34EApsilo\xEE\u1EE0h\xE9\u2EAFs\xBB\u2852\u0280bcmnp\u34FB\u355E\u1209\u358B\u358E\u0480;Edemnprs\u350E\u350F\u3511\u3515\u351E\u3523\u352C\u3531\u3536\u6282;\u6AC5ot;\u6ABD\u0100;d\u11DA\u351Aot;\u6AC3ult;\u6AC1\u0100Ee\u3528\u352A;\u6ACB;\u628Alus;\u6ABFarr;\u6979\u0180eiu\u353D\u3552\u3555t\u0180;en\u350E\u3545\u354Bq\u0100;q\u11DA\u350Feq\u0100;q\u352B\u3528m;\u6AC7\u0100bp\u355A\u355C;\u6AD5;\u6AD3c\u0300;acens\u11ED\u356C\u3572\u3579\u357B\u3326ppro\xF8\u32FAurlye\xF1\u11FE\xF1\u11F3\u0180aes\u3582\u3588\u331Bppro\xF8\u331Aq\xF1\u3317g;\u666A\u0680123;Edehlmnps\u35A9\u35AC\u35AF\u121C\u35B2\u35B4\u35C0\u35C9\u35D5\u35DA\u35DF\u35E8\u35ED\u803B\xB9\u40B9\u803B\xB2\u40B2\u803B\xB3\u40B3;\u6AC6\u0100os\u35B9\u35BCt;\u6ABEub;\u6AD8\u0100;d\u1222\u35C5ot;\u6AC4s\u0100ou\u35CF\u35D2l;\u67C9b;\u6AD7arr;\u697Bult;\u6AC2\u0100Ee\u35E4\u35E6;\u6ACC;\u628Blus;\u6AC0\u0180eiu\u35F4\u3609\u360Ct\u0180;en\u121C\u35FC\u3602q\u0100;q\u1222\u35B2eq\u0100;q\u35E7\u35E4m;\u6AC8\u0100bp\u3611\u3613;\u6AD4;\u6AD6\u0180Aan\u361C\u3620\u362Drr;\u61D9r\u0100hr\u3626\u3628\xEB\u222E\u0100;o\u0A2B\u0A29war;\u692Alig\u803B\xDF\u40DF\u0BE1\u3651\u365D\u3660\u12CE\u3673\u3679\x00\u367E\u36C2\x00\x00\x00\x00\x00\u36DB\u3703\x00\u3709\u376C\x00\x00\x00\u3787\u0272\u3656\x00\x00\u365Bget;\u6316;\u43C4r\xEB\u0E5F\u0180aey\u3666\u366B\u3670ron;\u4165dil;\u4163;\u4442lrec;\u6315r;\uC000\uD835\uDD31\u0200eiko\u3686\u369D\u36B5\u36BC\u01F2\u368B\x00\u3691e\u01004f\u1284\u1281a\u0180;sv\u3698\u3699\u369B\u43B8ym;\u43D1\u0100cn\u36A2\u36B2k\u0100as\u36A8\u36AEppro\xF8\u12C1im\xBB\u12ACs\xF0\u129E\u0100as\u36BA\u36AE\xF0\u12C1rn\u803B\xFE\u40FE\u01EC\u031F\u36C6\u22E7es\u8180\xD7;bd\u36CF\u36D0\u36D8\u40D7\u0100;a\u190F\u36D5r;\u6A31;\u6A30\u0180eps\u36E1\u36E3\u3700\xE1\u2A4D\u0200;bcf\u0486\u36EC\u36F0\u36F4ot;\u6336ir;\u6AF1\u0100;o\u36F9\u36FC\uC000\uD835\uDD65rk;\u6ADA\xE1\u3362rime;\u6034\u0180aip\u370F\u3712\u3764d\xE5\u1248\u0380adempst\u3721\u374D\u3740\u3751\u3757\u375C\u375Fngle\u0280;dlqr\u3730\u3731\u3736\u3740\u3742\u65B5own\xBB\u1DBBeft\u0100;e\u2800\u373E\xF1\u092E;\u625Cight\u0100;e\u32AA\u374B\xF1\u105Aot;\u65ECinus;\u6A3Alus;\u6A39b;\u69CDime;\u6A3Bezium;\u63E2\u0180cht\u3772\u377D\u3781\u0100ry\u3777\u377B;\uC000\uD835\uDCC9;\u4446cy;\u445Brok;\u4167\u0100io\u378B\u378Ex\xF4\u1777head\u0100lr\u3797\u37A0eftarro\xF7\u084Fightarrow\xBB\u0F5D\u0900AHabcdfghlmoprstuw\u37D0\u37D3\u37D7\u37E4\u37F0\u37FC\u380E\u381C\u3823\u3834\u3851\u385D\u386B\u38A9\u38CC\u38D2\u38EA\u38F6r\xF2\u03EDar;\u6963\u0100cr\u37DC\u37E2ute\u803B\xFA\u40FA\xF2\u1150r\u01E3\u37EA\x00\u37EDy;\u445Eve;\u416D\u0100iy\u37F5\u37FArc\u803B\xFB\u40FB;\u4443\u0180abh\u3803\u3806\u380Br\xF2\u13ADlac;\u4171a\xF2\u13C3\u0100ir\u3813\u3818sht;\u697E;\uC000\uD835\uDD32rave\u803B\xF9\u40F9\u0161\u3827\u3831r\u0100lr\u382C\u382E\xBB\u0957\xBB\u1083lk;\u6580\u0100ct\u3839\u384D\u026F\u383F\x00\x00\u384Arn\u0100;e\u3845\u3846\u631Cr\xBB\u3846op;\u630Fri;\u65F8\u0100al\u3856\u385Acr;\u416B\u80BB\xA8\u0349\u0100gp\u3862\u3866on;\u4173f;\uC000\uD835\uDD66\u0300adhlsu\u114B\u3878\u387D\u1372\u3891\u38A0own\xE1\u13B3arpoon\u0100lr\u3888\u388Cef\xF4\u382Digh\xF4\u382Fi\u0180;hl\u3899\u389A\u389C\u43C5\xBB\u13FAon\xBB\u389Aparrows;\u61C8\u0180cit\u38B0\u38C4\u38C8\u026F\u38B6\x00\x00\u38C1rn\u0100;e\u38BC\u38BD\u631Dr\xBB\u38BDop;\u630Eng;\u416Fri;\u65F9cr;\uC000\uD835\uDCCA\u0180dir\u38D9\u38DD\u38E2ot;\u62F0lde;\u4169i\u0100;f\u3730\u38E8\xBB\u1813\u0100am\u38EF\u38F2r\xF2\u38A8l\u803B\xFC\u40FCangle;\u69A7\u0780ABDacdeflnoprsz\u391C\u391F\u3929\u392D\u39B5\u39B8\u39BD\u39DF\u39E4\u39E8\u39F3\u39F9\u39FD\u3A01\u3A20r\xF2\u03F7ar\u0100;v\u3926\u3927\u6AE8;\u6AE9as\xE8\u03E1\u0100nr\u3932\u3937grt;\u699C\u0380eknprst\u34E3\u3946\u394B\u3952\u395D\u3964\u3996app\xE1\u2415othin\xE7\u1E96\u0180hir\u34EB\u2EC8\u3959op\xF4\u2FB5\u0100;h\u13B7\u3962\xEF\u318D\u0100iu\u3969\u396Dgm\xE1\u33B3\u0100bp\u3972\u3984setneq\u0100;q\u397D\u3980\uC000\u228A\uFE00;\uC000\u2ACB\uFE00setneq\u0100;q\u398F\u3992\uC000\u228B\uFE00;\uC000\u2ACC\uFE00\u0100hr\u399B\u399Fet\xE1\u369Ciangle\u0100lr\u39AA\u39AFeft\xBB\u0925ight\xBB\u1051y;\u4432ash\xBB\u1036\u0180elr\u39C4\u39D2\u39D7\u0180;be\u2DEA\u39CB\u39CFar;\u62BBq;\u625Alip;\u62EE\u0100bt\u39DC\u1468a\xF2\u1469r;\uC000\uD835\uDD33tr\xE9\u39AEsu\u0100bp\u39EF\u39F1\xBB\u0D1C\xBB\u0D59pf;\uC000\uD835\uDD67ro\xF0\u0EFBtr\xE9\u39B4\u0100cu\u3A06\u3A0Br;\uC000\uD835\uDCCB\u0100bp\u3A10\u3A18n\u0100Ee\u3980\u3A16\xBB\u397En\u0100Ee\u3992\u3A1E\xBB\u3990igzag;\u699A\u0380cefoprs\u3A36\u3A3B\u3A56\u3A5B\u3A54\u3A61\u3A6Airc;\u4175\u0100di\u3A40\u3A51\u0100bg\u3A45\u3A49ar;\u6A5Fe\u0100;q\u15FA\u3A4F;\u6259erp;\u6118r;\uC000\uD835\uDD34pf;\uC000\uD835\uDD68\u0100;e\u1479\u3A66at\xE8\u1479cr;\uC000\uD835\uDCCC\u0AE3\u178E\u3A87\x00\u3A8B\x00\u3A90\u3A9B\x00\x00\u3A9D\u3AA8\u3AAB\u3AAF\x00\x00\u3AC3\u3ACE\x00\u3AD8\u17DC\u17DFtr\xE9\u17D1r;\uC000\uD835\uDD35\u0100Aa\u3A94\u3A97r\xF2\u03C3r\xF2\u09F6;\u43BE\u0100Aa\u3AA1\u3AA4r\xF2\u03B8r\xF2\u09EBa\xF0\u2713is;\u62FB\u0180dpt\u17A4\u3AB5\u3ABE\u0100fl\u3ABA\u17A9;\uC000\uD835\uDD69im\xE5\u17B2\u0100Aa\u3AC7\u3ACAr\xF2\u03CEr\xF2\u0A01\u0100cq\u3AD2\u17B8r;\uC000\uD835\uDCCD\u0100pt\u17D6\u3ADCr\xE9\u17D4\u0400acefiosu\u3AF0\u3AFD\u3B08\u3B0C\u3B11\u3B15\u3B1B\u3B21c\u0100uy\u3AF6\u3AFBte\u803B\xFD\u40FD;\u444F\u0100iy\u3B02\u3B06rc;\u4177;\u444Bn\u803B\xA5\u40A5r;\uC000\uD835\uDD36cy;\u4457pf;\uC000\uD835\uDD6Acr;\uC000\uD835\uDCCE\u0100cm\u3B26\u3B29y;\u444El\u803B\xFF\u40FF\u0500acdefhiosw\u3B42\u3B48\u3B54\u3B58\u3B64\u3B69\u3B6D\u3B74\u3B7A\u3B80cute;\u417A\u0100ay\u3B4D\u3B52ron;\u417E;\u4437ot;\u417C\u0100et\u3B5D\u3B61tr\xE6\u155Fa;\u43B6r;\uC000\uD835\uDD37cy;\u4436grarr;\u61DDpf;\uC000\uD835\uDD6Bcr;\uC000\uD835\uDCCF\u0100jn\u3B85\u3B87;\u600Dj;\u600C".split("").map((e) => e.charCodeAt(0)));

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/node_modules/entities/dist/esm/decode-codepoint.js
var Is, jc = /* @__PURE__ */ new Map([
  [0, 65533],
  [128, 8364],
  [130, 8218],
  [131, 402],
  [132, 8222],
  [133, 8230],
  [134, 8224],
  [135, 8225],
  [136, 710],
  [137, 8240],
  [138, 352],
  [139, 8249],
  [140, 338],
  [142, 381],
  [145, 8216],
  [146, 8217],
  [147, 8220],
  [148, 8221],
  [149, 8226],
  [150, 8211],
  [151, 8212],
  [152, 732],
  [153, 8482],
  [154, 353],
  [155, 8250],
  [156, 339],
  [158, 382],
  [159, 376]
]), zc = (Is = String.fromCodePoint) !== null && Is !== void 0 ? Is : function(e) {
  let t = "";
  if (e > 65535)
    e -= 65536, t += String.fromCharCode(e >>> 10 & 1023 | 55296), e = 56320 | e & 1023;
  return t += String.fromCharCode(e), t;
};
function ui(e) {
  var t;
  if (e >= 55296 && e <= 57343 || e > 1114111)
    return 65533;
  return (t = jc.get(e)) !== null && t !== void 0 ? t : e;
}
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/node_modules/entities/dist/esm/decode.js
var U;
(function(e) {
  e[e.NUM = 35] = "NUM", e[e.SEMI = 59] = "SEMI", e[e.EQUALS = 61] = "EQUALS", e[e.ZERO = 48] = "ZERO", e[e.NINE = 57] = "NINE", e[e.LOWER_A = 97] = "LOWER_A", e[e.LOWER_F = 102] = "LOWER_F", e[e.LOWER_X = 120] = "LOWER_X", e[e.LOWER_Z = 122] = "LOWER_Z", e[e.UPPER_A = 65] = "UPPER_A", e[e.UPPER_F = 70] = "UPPER_F", e[e.UPPER_Z = 90] = "UPPER_Z";
})(U || (U = {}));
var $c = 32, Ne;
(function(e) {
  e[e.VALUE_LENGTH = 49152] = "VALUE_LENGTH", e[e.BRANCH_LENGTH = 16256] = "BRANCH_LENGTH", e[e.JUMP_TABLE = 127] = "JUMP_TABLE";
})(Ne || (Ne = {}));
function Cs(e) {
  return e >= U.ZERO && e <= U.NINE;
}
function eA(e) {
  return e >= U.UPPER_A && e <= U.UPPER_F || e >= U.LOWER_A && e <= U.LOWER_F;
}
function tA(e) {
  return e >= U.UPPER_A && e <= U.UPPER_Z || e >= U.LOWER_A && e <= U.LOWER_Z || Cs(e);
}
function uA(e) {
  return e === U.EQUALS || tA(e);
}
var H;
(function(e) {
  e[e.EntityStart = 0] = "EntityStart", e[e.NumericStart = 1] = "NumericStart", e[e.NumericDecimal = 2] = "NumericDecimal", e[e.NumericHex = 3] = "NumericHex", e[e.NamedEntity = 4] = "NamedEntity";
})(H || (H = {}));
var ae;
(function(e) {
  e[e.Legacy = 0] = "Legacy", e[e.Strict = 1] = "Strict", e[e.Attribute = 2] = "Attribute";
})(ae || (ae = {}));

class _s {
  constructor(e, t, u) {
    this.decodeTree = e, this.emitCodePoint = t, this.errors = u, this.state = H.EntityStart, this.consumed = 1, this.result = 0, this.treeIndex = 0, this.excess = 1, this.decodeMode = ae.Strict;
  }
  startEntity(e) {
    this.decodeMode = e, this.state = H.EntityStart, this.result = 0, this.treeIndex = 0, this.excess = 1, this.consumed = 1;
  }
  write(e, t) {
    switch (this.state) {
      case H.EntityStart: {
        if (e.charCodeAt(t) === U.NUM)
          return this.state = H.NumericStart, this.consumed += 1, this.stateNumericStart(e, t + 1);
        return this.state = H.NamedEntity, this.stateNamedEntity(e, t);
      }
      case H.NumericStart:
        return this.stateNumericStart(e, t);
      case H.NumericDecimal:
        return this.stateNumericDecimal(e, t);
      case H.NumericHex:
        return this.stateNumericHex(e, t);
      case H.NamedEntity:
        return this.stateNamedEntity(e, t);
    }
  }
  stateNumericStart(e, t) {
    if (t >= e.length)
      return -1;
    if ((e.charCodeAt(t) | $c) === U.LOWER_X)
      return this.state = H.NumericHex, this.consumed += 1, this.stateNumericHex(e, t + 1);
    return this.state = H.NumericDecimal, this.stateNumericDecimal(e, t);
  }
  addToNumericResult(e, t, u, s) {
    if (t !== u) {
      let i = u - t;
      this.result = this.result * Math.pow(s, i) + Number.parseInt(e.substr(t, i), s), this.consumed += i;
    }
  }
  stateNumericHex(e, t) {
    let u = t;
    while (t < e.length) {
      let s = e.charCodeAt(t);
      if (Cs(s) || eA(s))
        t += 1;
      else
        return this.addToNumericResult(e, u, t, 16), this.emitNumericEntity(s, 3);
    }
    return this.addToNumericResult(e, u, t, 16), -1;
  }
  stateNumericDecimal(e, t) {
    let u = t;
    while (t < e.length) {
      let s = e.charCodeAt(t);
      if (Cs(s))
        t += 1;
      else
        return this.addToNumericResult(e, u, t, 10), this.emitNumericEntity(s, 2);
    }
    return this.addToNumericResult(e, u, t, 10), -1;
  }
  emitNumericEntity(e, t) {
    var u;
    if (this.consumed <= t)
      return (u = this.errors) === null || u === void 0 || u.absenceOfDigitsInNumericCharacterReference(this.consumed), 0;
    if (e === U.SEMI)
      this.consumed += 1;
    else if (this.decodeMode === ae.Strict)
      return 0;
    if (this.emitCodePoint(ui(this.result), this.consumed), this.errors) {
      if (e !== U.SEMI)
        this.errors.missingSemicolonAfterCharacterReference();
      this.errors.validateNumericCharacterReference(this.result);
    }
    return this.consumed;
  }
  stateNamedEntity(e, t) {
    let { decodeTree: u } = this, s = u[this.treeIndex], i = (s & Ne.VALUE_LENGTH) >> 14;
    for (;t < e.length; t++, this.excess++) {
      let n = e.charCodeAt(t);
      if (this.treeIndex = sA(u, s, this.treeIndex + Math.max(1, i), n), this.treeIndex < 0)
        return this.result === 0 || this.decodeMode === ae.Attribute && (i === 0 || uA(n)) ? 0 : this.emitNotTerminatedNamedEntity();
      if (s = u[this.treeIndex], i = (s & Ne.VALUE_LENGTH) >> 14, i !== 0) {
        if (n === U.SEMI)
          return this.emitNamedEntityData(this.treeIndex, i, this.consumed + this.excess);
        if (this.decodeMode !== ae.Strict)
          this.result = this.treeIndex, this.consumed += this.excess, this.excess = 0;
      }
    }
    return -1;
  }
  emitNotTerminatedNamedEntity() {
    var e;
    let { result: t, decodeTree: u } = this, s = (u[t] & Ne.VALUE_LENGTH) >> 14;
    return this.emitNamedEntityData(t, s, this.consumed), (e = this.errors) === null || e === void 0 || e.missingSemicolonAfterCharacterReference(), this.consumed;
  }
  emitNamedEntityData(e, t, u) {
    let { decodeTree: s } = this;
    if (this.emitCodePoint(t === 1 ? s[e] & ~Ne.VALUE_LENGTH : s[e + 1], u), t === 3)
      this.emitCodePoint(s[e + 2], u);
    return u;
  }
  end() {
    var e;
    switch (this.state) {
      case H.NamedEntity:
        return this.result !== 0 && (this.decodeMode !== ae.Attribute || this.result === this.treeIndex) ? this.emitNotTerminatedNamedEntity() : 0;
      case H.NumericDecimal:
        return this.emitNumericEntity(0, 2);
      case H.NumericHex:
        return this.emitNumericEntity(0, 3);
      case H.NumericStart:
        return (e = this.errors) === null || e === void 0 || e.absenceOfDigitsInNumericCharacterReference(this.consumed), 0;
      case H.EntityStart:
        return 0;
    }
  }
}
function sA(e, t, u, s) {
  let i = (t & Ne.BRANCH_LENGTH) >> 7, n = t & Ne.JUMP_TABLE;
  if (i === 0)
    return n !== 0 && s === n ? u : -1;
  if (n) {
    let l = s - n;
    return l < 0 || l >= i ? -1 : e[u + l] - 1;
  }
  let a = u, d = a + i - 1;
  while (a <= d) {
    let l = a + d >>> 1, f = e[l];
    if (f < s)
      a = l + 1;
    else if (f > s)
      d = l - 1;
    else
      return e[l + i];
  }
  return -1;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/common/html.js
var m;
(function(e) {
  e.HTML = "http://www.w3.org/1999/xhtml", e.MATHML = "http://www.w3.org/1998/Math/MathML", e.SVG = "http://www.w3.org/2000/svg", e.XLINK = "http://www.w3.org/1999/xlink", e.XML = "http://www.w3.org/XML/1998/namespace", e.XMLNS = "http://www.w3.org/2000/xmlns/";
})(m || (m = {}));
var fe;
(function(e) {
  e.TYPE = "type", e.ACTION = "action", e.ENCODING = "encoding", e.PROMPT = "prompt", e.NAME = "name", e.COLOR = "color", e.FACE = "face", e.SIZE = "size";
})(fe || (fe = {}));
var Y;
(function(e) {
  e.NO_QUIRKS = "no-quirks", e.QUIRKS = "quirks", e.LIMITED_QUIRKS = "limited-quirks";
})(Y || (Y = {}));
var h;
(function(e) {
  e.A = "a", e.ADDRESS = "address", e.ANNOTATION_XML = "annotation-xml", e.APPLET = "applet", e.AREA = "area", e.ARTICLE = "article", e.ASIDE = "aside", e.B = "b", e.BASE = "base", e.BASEFONT = "basefont", e.BGSOUND = "bgsound", e.BIG = "big", e.BLOCKQUOTE = "blockquote", e.BODY = "body", e.BR = "br", e.BUTTON = "button", e.CAPTION = "caption", e.CENTER = "center", e.CODE = "code", e.COL = "col", e.COLGROUP = "colgroup", e.DD = "dd", e.DESC = "desc", e.DETAILS = "details", e.DIALOG = "dialog", e.DIR = "dir", e.DIV = "div", e.DL = "dl", e.DT = "dt", e.EM = "em", e.EMBED = "embed", e.FIELDSET = "fieldset", e.FIGCAPTION = "figcaption", e.FIGURE = "figure", e.FONT = "font", e.FOOTER = "footer", e.FOREIGN_OBJECT = "foreignObject", e.FORM = "form", e.FRAME = "frame", e.FRAMESET = "frameset", e.H1 = "h1", e.H2 = "h2", e.H3 = "h3", e.H4 = "h4", e.H5 = "h5", e.H6 = "h6", e.HEAD = "head", e.HEADER = "header", e.HGROUP = "hgroup", e.HR = "hr", e.HTML = "html", e.I = "i", e.IMG = "img", e.IMAGE = "image", e.INPUT = "input", e.IFRAME = "iframe", e.KEYGEN = "keygen", e.LABEL = "label", e.LI = "li", e.LINK = "link", e.LISTING = "listing", e.MAIN = "main", e.MALIGNMARK = "malignmark", e.MARQUEE = "marquee", e.MATH = "math", e.MENU = "menu", e.META = "meta", e.MGLYPH = "mglyph", e.MI = "mi", e.MO = "mo", e.MN = "mn", e.MS = "ms", e.MTEXT = "mtext", e.NAV = "nav", e.NOBR = "nobr", e.NOFRAMES = "noframes", e.NOEMBED = "noembed", e.NOSCRIPT = "noscript", e.OBJECT = "object", e.OL = "ol", e.OPTGROUP = "optgroup", e.OPTION = "option", e.P = "p", e.PARAM = "param", e.PLAINTEXT = "plaintext", e.PRE = "pre", e.RB = "rb", e.RP = "rp", e.RT = "rt", e.RTC = "rtc", e.RUBY = "ruby", e.S = "s", e.SCRIPT = "script", e.SEARCH = "search", e.SECTION = "section", e.SELECT = "select", e.SOURCE = "source", e.SMALL = "small", e.SPAN = "span", e.STRIKE = "strike", e.STRONG = "strong", e.STYLE = "style", e.SUB = "sub", e.SUMMARY = "summary", e.SUP = "sup", e.TABLE = "table", e.TBODY = "tbody", e.TEMPLATE = "template", e.TEXTAREA = "textarea", e.TFOOT = "tfoot", e.TD = "td", e.TH = "th", e.THEAD = "thead", e.TITLE = "title", e.TR = "tr", e.TRACK = "track", e.TT = "tt", e.U = "u", e.UL = "ul", e.SVG = "svg", e.VAR = "var", e.WBR = "wbr", e.XMP = "xmp";
})(h || (h = {}));
var r;
(function(e) {
  e[e.UNKNOWN = 0] = "UNKNOWN", e[e.A = 1] = "A", e[e.ADDRESS = 2] = "ADDRESS", e[e.ANNOTATION_XML = 3] = "ANNOTATION_XML", e[e.APPLET = 4] = "APPLET", e[e.AREA = 5] = "AREA", e[e.ARTICLE = 6] = "ARTICLE", e[e.ASIDE = 7] = "ASIDE", e[e.B = 8] = "B", e[e.BASE = 9] = "BASE", e[e.BASEFONT = 10] = "BASEFONT", e[e.BGSOUND = 11] = "BGSOUND", e[e.BIG = 12] = "BIG", e[e.BLOCKQUOTE = 13] = "BLOCKQUOTE", e[e.BODY = 14] = "BODY", e[e.BR = 15] = "BR", e[e.BUTTON = 16] = "BUTTON", e[e.CAPTION = 17] = "CAPTION", e[e.CENTER = 18] = "CENTER", e[e.CODE = 19] = "CODE", e[e.COL = 20] = "COL", e[e.COLGROUP = 21] = "COLGROUP", e[e.DD = 22] = "DD", e[e.DESC = 23] = "DESC", e[e.DETAILS = 24] = "DETAILS", e[e.DIALOG = 25] = "DIALOG", e[e.DIR = 26] = "DIR", e[e.DIV = 27] = "DIV", e[e.DL = 28] = "DL", e[e.DT = 29] = "DT", e[e.EM = 30] = "EM", e[e.EMBED = 31] = "EMBED", e[e.FIELDSET = 32] = "FIELDSET", e[e.FIGCAPTION = 33] = "FIGCAPTION", e[e.FIGURE = 34] = "FIGURE", e[e.FONT = 35] = "FONT", e[e.FOOTER = 36] = "FOOTER", e[e.FOREIGN_OBJECT = 37] = "FOREIGN_OBJECT", e[e.FORM = 38] = "FORM", e[e.FRAME = 39] = "FRAME", e[e.FRAMESET = 40] = "FRAMESET", e[e.H1 = 41] = "H1", e[e.H2 = 42] = "H2", e[e.H3 = 43] = "H3", e[e.H4 = 44] = "H4", e[e.H5 = 45] = "H5", e[e.H6 = 46] = "H6", e[e.HEAD = 47] = "HEAD", e[e.HEADER = 48] = "HEADER", e[e.HGROUP = 49] = "HGROUP", e[e.HR = 50] = "HR", e[e.HTML = 51] = "HTML", e[e.I = 52] = "I", e[e.IMG = 53] = "IMG", e[e.IMAGE = 54] = "IMAGE", e[e.INPUT = 55] = "INPUT", e[e.IFRAME = 56] = "IFRAME", e[e.KEYGEN = 57] = "KEYGEN", e[e.LABEL = 58] = "LABEL", e[e.LI = 59] = "LI", e[e.LINK = 60] = "LINK", e[e.LISTING = 61] = "LISTING", e[e.MAIN = 62] = "MAIN", e[e.MALIGNMARK = 63] = "MALIGNMARK", e[e.MARQUEE = 64] = "MARQUEE", e[e.MATH = 65] = "MATH", e[e.MENU = 66] = "MENU", e[e.META = 67] = "META", e[e.MGLYPH = 68] = "MGLYPH", e[e.MI = 69] = "MI", e[e.MO = 70] = "MO", e[e.MN = 71] = "MN", e[e.MS = 72] = "MS", e[e.MTEXT = 73] = "MTEXT", e[e.NAV = 74] = "NAV", e[e.NOBR = 75] = "NOBR", e[e.NOFRAMES = 76] = "NOFRAMES", e[e.NOEMBED = 77] = "NOEMBED", e[e.NOSCRIPT = 78] = "NOSCRIPT", e[e.OBJECT = 79] = "OBJECT", e[e.OL = 80] = "OL", e[e.OPTGROUP = 81] = "OPTGROUP", e[e.OPTION = 82] = "OPTION", e[e.P = 83] = "P", e[e.PARAM = 84] = "PARAM", e[e.PLAINTEXT = 85] = "PLAINTEXT", e[e.PRE = 86] = "PRE", e[e.RB = 87] = "RB", e[e.RP = 88] = "RP", e[e.RT = 89] = "RT", e[e.RTC = 90] = "RTC", e[e.RUBY = 91] = "RUBY", e[e.S = 92] = "S", e[e.SCRIPT = 93] = "SCRIPT", e[e.SEARCH = 94] = "SEARCH", e[e.SECTION = 95] = "SECTION", e[e.SELECT = 96] = "SELECT", e[e.SOURCE = 97] = "SOURCE", e[e.SMALL = 98] = "SMALL", e[e.SPAN = 99] = "SPAN", e[e.STRIKE = 100] = "STRIKE", e[e.STRONG = 101] = "STRONG", e[e.STYLE = 102] = "STYLE", e[e.SUB = 103] = "SUB", e[e.SUMMARY = 104] = "SUMMARY", e[e.SUP = 105] = "SUP", e[e.TABLE = 106] = "TABLE", e[e.TBODY = 107] = "TBODY", e[e.TEMPLATE = 108] = "TEMPLATE", e[e.TEXTAREA = 109] = "TEXTAREA", e[e.TFOOT = 110] = "TFOOT", e[e.TD = 111] = "TD", e[e.TH = 112] = "TH", e[e.THEAD = 113] = "THEAD", e[e.TITLE = 114] = "TITLE", e[e.TR = 115] = "TR", e[e.TRACK = 116] = "TRACK", e[e.TT = 117] = "TT", e[e.U = 118] = "U", e[e.UL = 119] = "UL", e[e.SVG = 120] = "SVG", e[e.VAR = 121] = "VAR", e[e.WBR = 122] = "WBR", e[e.XMP = 123] = "XMP";
})(r || (r = {}));
var rA = /* @__PURE__ */ new Map([
  [h.A, r.A],
  [h.ADDRESS, r.ADDRESS],
  [h.ANNOTATION_XML, r.ANNOTATION_XML],
  [h.APPLET, r.APPLET],
  [h.AREA, r.AREA],
  [h.ARTICLE, r.ARTICLE],
  [h.ASIDE, r.ASIDE],
  [h.B, r.B],
  [h.BASE, r.BASE],
  [h.BASEFONT, r.BASEFONT],
  [h.BGSOUND, r.BGSOUND],
  [h.BIG, r.BIG],
  [h.BLOCKQUOTE, r.BLOCKQUOTE],
  [h.BODY, r.BODY],
  [h.BR, r.BR],
  [h.BUTTON, r.BUTTON],
  [h.CAPTION, r.CAPTION],
  [h.CENTER, r.CENTER],
  [h.CODE, r.CODE],
  [h.COL, r.COL],
  [h.COLGROUP, r.COLGROUP],
  [h.DD, r.DD],
  [h.DESC, r.DESC],
  [h.DETAILS, r.DETAILS],
  [h.DIALOG, r.DIALOG],
  [h.DIR, r.DIR],
  [h.DIV, r.DIV],
  [h.DL, r.DL],
  [h.DT, r.DT],
  [h.EM, r.EM],
  [h.EMBED, r.EMBED],
  [h.FIELDSET, r.FIELDSET],
  [h.FIGCAPTION, r.FIGCAPTION],
  [h.FIGURE, r.FIGURE],
  [h.FONT, r.FONT],
  [h.FOOTER, r.FOOTER],
  [h.FOREIGN_OBJECT, r.FOREIGN_OBJECT],
  [h.FORM, r.FORM],
  [h.FRAME, r.FRAME],
  [h.FRAMESET, r.FRAMESET],
  [h.H1, r.H1],
  [h.H2, r.H2],
  [h.H3, r.H3],
  [h.H4, r.H4],
  [h.H5, r.H5],
  [h.H6, r.H6],
  [h.HEAD, r.HEAD],
  [h.HEADER, r.HEADER],
  [h.HGROUP, r.HGROUP],
  [h.HR, r.HR],
  [h.HTML, r.HTML],
  [h.I, r.I],
  [h.IMG, r.IMG],
  [h.IMAGE, r.IMAGE],
  [h.INPUT, r.INPUT],
  [h.IFRAME, r.IFRAME],
  [h.KEYGEN, r.KEYGEN],
  [h.LABEL, r.LABEL],
  [h.LI, r.LI],
  [h.LINK, r.LINK],
  [h.LISTING, r.LISTING],
  [h.MAIN, r.MAIN],
  [h.MALIGNMARK, r.MALIGNMARK],
  [h.MARQUEE, r.MARQUEE],
  [h.MATH, r.MATH],
  [h.MENU, r.MENU],
  [h.META, r.META],
  [h.MGLYPH, r.MGLYPH],
  [h.MI, r.MI],
  [h.MO, r.MO],
  [h.MN, r.MN],
  [h.MS, r.MS],
  [h.MTEXT, r.MTEXT],
  [h.NAV, r.NAV],
  [h.NOBR, r.NOBR],
  [h.NOFRAMES, r.NOFRAMES],
  [h.NOEMBED, r.NOEMBED],
  [h.NOSCRIPT, r.NOSCRIPT],
  [h.OBJECT, r.OBJECT],
  [h.OL, r.OL],
  [h.OPTGROUP, r.OPTGROUP],
  [h.OPTION, r.OPTION],
  [h.P, r.P],
  [h.PARAM, r.PARAM],
  [h.PLAINTEXT, r.PLAINTEXT],
  [h.PRE, r.PRE],
  [h.RB, r.RB],
  [h.RP, r.RP],
  [h.RT, r.RT],
  [h.RTC, r.RTC],
  [h.RUBY, r.RUBY],
  [h.S, r.S],
  [h.SCRIPT, r.SCRIPT],
  [h.SEARCH, r.SEARCH],
  [h.SECTION, r.SECTION],
  [h.SELECT, r.SELECT],
  [h.SOURCE, r.SOURCE],
  [h.SMALL, r.SMALL],
  [h.SPAN, r.SPAN],
  [h.STRIKE, r.STRIKE],
  [h.STRONG, r.STRONG],
  [h.STYLE, r.STYLE],
  [h.SUB, r.SUB],
  [h.SUMMARY, r.SUMMARY],
  [h.SUP, r.SUP],
  [h.TABLE, r.TABLE],
  [h.TBODY, r.TBODY],
  [h.TEMPLATE, r.TEMPLATE],
  [h.TEXTAREA, r.TEXTAREA],
  [h.TFOOT, r.TFOOT],
  [h.TD, r.TD],
  [h.TH, r.TH],
  [h.THEAD, r.THEAD],
  [h.TITLE, r.TITLE],
  [h.TR, r.TR],
  [h.TRACK, r.TRACK],
  [h.TT, r.TT],
  [h.U, r.U],
  [h.UL, r.UL],
  [h.SVG, r.SVG],
  [h.VAR, r.VAR],
  [h.WBR, r.WBR],
  [h.XMP, r.XMP]
]);
function we(e) {
  var t;
  return (t = rA.get(e)) !== null && t !== void 0 ? t : r.UNKNOWN;
}
var b = r, si = {
  [m.HTML]: /* @__PURE__ */ new Set([
    b.ADDRESS,
    b.APPLET,
    b.AREA,
    b.ARTICLE,
    b.ASIDE,
    b.BASE,
    b.BASEFONT,
    b.BGSOUND,
    b.BLOCKQUOTE,
    b.BODY,
    b.BR,
    b.BUTTON,
    b.CAPTION,
    b.CENTER,
    b.COL,
    b.COLGROUP,
    b.DD,
    b.DETAILS,
    b.DIR,
    b.DIV,
    b.DL,
    b.DT,
    b.EMBED,
    b.FIELDSET,
    b.FIGCAPTION,
    b.FIGURE,
    b.FOOTER,
    b.FORM,
    b.FRAME,
    b.FRAMESET,
    b.H1,
    b.H2,
    b.H3,
    b.H4,
    b.H5,
    b.H6,
    b.HEAD,
    b.HEADER,
    b.HGROUP,
    b.HR,
    b.HTML,
    b.IFRAME,
    b.IMG,
    b.INPUT,
    b.LI,
    b.LINK,
    b.LISTING,
    b.MAIN,
    b.MARQUEE,
    b.MENU,
    b.META,
    b.NAV,
    b.NOEMBED,
    b.NOFRAMES,
    b.NOSCRIPT,
    b.OBJECT,
    b.OL,
    b.P,
    b.PARAM,
    b.PLAINTEXT,
    b.PRE,
    b.SCRIPT,
    b.SECTION,
    b.SELECT,
    b.SOURCE,
    b.STYLE,
    b.SUMMARY,
    b.TABLE,
    b.TBODY,
    b.TD,
    b.TEMPLATE,
    b.TEXTAREA,
    b.TFOOT,
    b.TH,
    b.THEAD,
    b.TITLE,
    b.TR,
    b.TRACK,
    b.UL,
    b.WBR,
    b.XMP
  ]),
  [m.MATHML]: /* @__PURE__ */ new Set([b.MI, b.MO, b.MN, b.MS, b.MTEXT, b.ANNOTATION_XML]),
  [m.SVG]: /* @__PURE__ */ new Set([b.TITLE, b.FOREIGN_OBJECT, b.DESC]),
  [m.XLINK]: /* @__PURE__ */ new Set,
  [m.XML]: /* @__PURE__ */ new Set,
  [m.XMLNS]: /* @__PURE__ */ new Set
}, ft = /* @__PURE__ */ new Set([b.H1, b.H2, b.H3, b.H4, b.H5, b.H6]), iA = /* @__PURE__ */ new Set([
  h.STYLE,
  h.SCRIPT,
  h.XMP,
  h.IFRAME,
  h.NOEMBED,
  h.NOFRAMES,
  h.PLAINTEXT
]);
function ri(e, t) {
  return iA.has(e) || t && e === h.NOSCRIPT;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/tokenizer/index.js
var A;
(function(e) {
  e[e.DATA = 0] = "DATA", e[e.RCDATA = 1] = "RCDATA", e[e.RAWTEXT = 2] = "RAWTEXT", e[e.SCRIPT_DATA = 3] = "SCRIPT_DATA", e[e.PLAINTEXT = 4] = "PLAINTEXT", e[e.TAG_OPEN = 5] = "TAG_OPEN", e[e.END_TAG_OPEN = 6] = "END_TAG_OPEN", e[e.TAG_NAME = 7] = "TAG_NAME", e[e.RCDATA_LESS_THAN_SIGN = 8] = "RCDATA_LESS_THAN_SIGN", e[e.RCDATA_END_TAG_OPEN = 9] = "RCDATA_END_TAG_OPEN", e[e.RCDATA_END_TAG_NAME = 10] = "RCDATA_END_TAG_NAME", e[e.RAWTEXT_LESS_THAN_SIGN = 11] = "RAWTEXT_LESS_THAN_SIGN", e[e.RAWTEXT_END_TAG_OPEN = 12] = "RAWTEXT_END_TAG_OPEN", e[e.RAWTEXT_END_TAG_NAME = 13] = "RAWTEXT_END_TAG_NAME", e[e.SCRIPT_DATA_LESS_THAN_SIGN = 14] = "SCRIPT_DATA_LESS_THAN_SIGN", e[e.SCRIPT_DATA_END_TAG_OPEN = 15] = "SCRIPT_DATA_END_TAG_OPEN", e[e.SCRIPT_DATA_END_TAG_NAME = 16] = "SCRIPT_DATA_END_TAG_NAME", e[e.SCRIPT_DATA_ESCAPE_START = 17] = "SCRIPT_DATA_ESCAPE_START", e[e.SCRIPT_DATA_ESCAPE_START_DASH = 18] = "SCRIPT_DATA_ESCAPE_START_DASH", e[e.SCRIPT_DATA_ESCAPED = 19] = "SCRIPT_DATA_ESCAPED", e[e.SCRIPT_DATA_ESCAPED_DASH = 20] = "SCRIPT_DATA_ESCAPED_DASH", e[e.SCRIPT_DATA_ESCAPED_DASH_DASH = 21] = "SCRIPT_DATA_ESCAPED_DASH_DASH", e[e.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN = 22] = "SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN", e[e.SCRIPT_DATA_ESCAPED_END_TAG_OPEN = 23] = "SCRIPT_DATA_ESCAPED_END_TAG_OPEN", e[e.SCRIPT_DATA_ESCAPED_END_TAG_NAME = 24] = "SCRIPT_DATA_ESCAPED_END_TAG_NAME", e[e.SCRIPT_DATA_DOUBLE_ESCAPE_START = 25] = "SCRIPT_DATA_DOUBLE_ESCAPE_START", e[e.SCRIPT_DATA_DOUBLE_ESCAPED = 26] = "SCRIPT_DATA_DOUBLE_ESCAPED", e[e.SCRIPT_DATA_DOUBLE_ESCAPED_DASH = 27] = "SCRIPT_DATA_DOUBLE_ESCAPED_DASH", e[e.SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH = 28] = "SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH", e[e.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN = 29] = "SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN", e[e.SCRIPT_DATA_DOUBLE_ESCAPE_END = 30] = "SCRIPT_DATA_DOUBLE_ESCAPE_END", e[e.BEFORE_ATTRIBUTE_NAME = 31] = "BEFORE_ATTRIBUTE_NAME", e[e.ATTRIBUTE_NAME = 32] = "ATTRIBUTE_NAME", e[e.AFTER_ATTRIBUTE_NAME = 33] = "AFTER_ATTRIBUTE_NAME", e[e.BEFORE_ATTRIBUTE_VALUE = 34] = "BEFORE_ATTRIBUTE_VALUE", e[e.ATTRIBUTE_VALUE_DOUBLE_QUOTED = 35] = "ATTRIBUTE_VALUE_DOUBLE_QUOTED", e[e.ATTRIBUTE_VALUE_SINGLE_QUOTED = 36] = "ATTRIBUTE_VALUE_SINGLE_QUOTED", e[e.ATTRIBUTE_VALUE_UNQUOTED = 37] = "ATTRIBUTE_VALUE_UNQUOTED", e[e.AFTER_ATTRIBUTE_VALUE_QUOTED = 38] = "AFTER_ATTRIBUTE_VALUE_QUOTED", e[e.SELF_CLOSING_START_TAG = 39] = "SELF_CLOSING_START_TAG", e[e.BOGUS_COMMENT = 40] = "BOGUS_COMMENT", e[e.MARKUP_DECLARATION_OPEN = 41] = "MARKUP_DECLARATION_OPEN", e[e.COMMENT_START = 42] = "COMMENT_START", e[e.COMMENT_START_DASH = 43] = "COMMENT_START_DASH", e[e.COMMENT = 44] = "COMMENT", e[e.COMMENT_LESS_THAN_SIGN = 45] = "COMMENT_LESS_THAN_SIGN", e[e.COMMENT_LESS_THAN_SIGN_BANG = 46] = "COMMENT_LESS_THAN_SIGN_BANG", e[e.COMMENT_LESS_THAN_SIGN_BANG_DASH = 47] = "COMMENT_LESS_THAN_SIGN_BANG_DASH", e[e.COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH = 48] = "COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH", e[e.COMMENT_END_DASH = 49] = "COMMENT_END_DASH", e[e.COMMENT_END = 50] = "COMMENT_END", e[e.COMMENT_END_BANG = 51] = "COMMENT_END_BANG", e[e.DOCTYPE = 52] = "DOCTYPE", e[e.BEFORE_DOCTYPE_NAME = 53] = "BEFORE_DOCTYPE_NAME", e[e.DOCTYPE_NAME = 54] = "DOCTYPE_NAME", e[e.AFTER_DOCTYPE_NAME = 55] = "AFTER_DOCTYPE_NAME", e[e.AFTER_DOCTYPE_PUBLIC_KEYWORD = 56] = "AFTER_DOCTYPE_PUBLIC_KEYWORD", e[e.BEFORE_DOCTYPE_PUBLIC_IDENTIFIER = 57] = "BEFORE_DOCTYPE_PUBLIC_IDENTIFIER", e[e.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED = 58] = "DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED", e[e.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED = 59] = "DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED", e[e.AFTER_DOCTYPE_PUBLIC_IDENTIFIER = 60] = "AFTER_DOCTYPE_PUBLIC_IDENTIFIER", e[e.BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS = 61] = "BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS", e[e.AFTER_DOCTYPE_SYSTEM_KEYWORD = 62] = "AFTER_DOCTYPE_SYSTEM_KEYWORD", e[e.BEFORE_DOCTYPE_SYSTEM_IDENTIFIER = 63] = "BEFORE_DOCTYPE_SYSTEM_IDENTIFIER", e[e.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED = 64] = "DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED", e[e.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED = 65] = "DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED", e[e.AFTER_DOCTYPE_SYSTEM_IDENTIFIER = 66] = "AFTER_DOCTYPE_SYSTEM_IDENTIFIER", e[e.BOGUS_DOCTYPE = 67] = "BOGUS_DOCTYPE", e[e.CDATA_SECTION = 68] = "CDATA_SECTION", e[e.CDATA_SECTION_BRACKET = 69] = "CDATA_SECTION_BRACKET", e[e.CDATA_SECTION_END = 70] = "CDATA_SECTION_END", e[e.CHARACTER_REFERENCE = 71] = "CHARACTER_REFERENCE", e[e.AMBIGUOUS_AMPERSAND = 72] = "AMBIGUOUS_AMPERSAND";
})(A || (A = {}));
var v = {
  DATA: A.DATA,
  RCDATA: A.RCDATA,
  RAWTEXT: A.RAWTEXT,
  SCRIPT_DATA: A.SCRIPT_DATA,
  PLAINTEXT: A.PLAINTEXT,
  CDATA_SECTION: A.CDATA_SECTION
};
function nA(e) {
  return e >= c.DIGIT_0 && e <= c.DIGIT_9;
}
function Et(e) {
  return e >= c.LATIN_CAPITAL_A && e <= c.LATIN_CAPITAL_Z;
}
function aA(e) {
  return e >= c.LATIN_SMALL_A && e <= c.LATIN_SMALL_Z;
}
function Se(e) {
  return aA(e) || Et(e);
}
function ni(e) {
  return Se(e) || nA(e);
}
function cu(e) {
  return e + 32;
}
function ci(e) {
  return e === c.SPACE || e === c.LINE_FEED || e === c.TABULATION || e === c.FORM_FEED;
}
function ai(e) {
  return ci(e) || e === c.SOLIDUS || e === c.GREATER_THAN_SIGN;
}
function cA(e) {
  if (e === c.NULL)
    return E.nullCharacterReference;
  else if (e > 1114111)
    return E.characterReferenceOutsideUnicodeRange;
  else if (ru(e))
    return E.surrogateCharacterReference;
  else if (nu(e))
    return E.noncharacterCharacterReference;
  else if (iu(e) || e === c.CARRIAGE_RETURN)
    return E.controlCharacterReference;
  return null;
}

class Au {
  constructor(e, t) {
    this.options = e, this.handler = t, this.paused = !1, this.inLoop = !1, this.inForeignNode = !1, this.lastStartTagName = "", this.active = !1, this.state = A.DATA, this.returnState = A.DATA, this.entityStartPos = 0, this.consumedAfterSnapshot = -1, this.currentCharacterToken = null, this.currentToken = null, this.currentAttr = { name: "", value: "" }, this.preprocessor = new bs(t), this.currentLocation = this.getCurrentLocation(-1), this.entityDecoder = new _s(ps, (u, s) => {
      this.preprocessor.pos = this.entityStartPos + s - 1, this._flushCodePointConsumedAsCharacterReference(u);
    }, t.onParseError ? {
      missingSemicolonAfterCharacterReference: () => {
        this._err(E.missingSemicolonAfterCharacterReference, 1);
      },
      absenceOfDigitsInNumericCharacterReference: (u) => {
        this._err(E.absenceOfDigitsInNumericCharacterReference, this.entityStartPos - this.preprocessor.pos + u);
      },
      validateNumericCharacterReference: (u) => {
        let s = cA(u);
        if (s)
          this._err(s, 1);
      }
    } : void 0);
  }
  _err(e, t = 0) {
    var u, s;
    (s = (u = this.handler).onParseError) === null || s === void 0 || s.call(u, this.preprocessor.getError(e, t));
  }
  getCurrentLocation(e) {
    if (!this.options.sourceCodeLocationInfo)
      return null;
    return {
      startLine: this.preprocessor.line,
      startCol: this.preprocessor.col - e,
      startOffset: this.preprocessor.offset - e,
      endLine: -1,
      endCol: -1,
      endOffset: -1
    };
  }
  _runParsingLoop() {
    if (this.inLoop)
      return;
    this.inLoop = !0;
    while (this.active && !this.paused) {
      this.consumedAfterSnapshot = 0;
      let e = this._consume();
      if (!this._ensureHibernation())
        this._callState(e);
    }
    this.inLoop = !1;
  }
  pause() {
    this.paused = !0;
  }
  resume(e) {
    if (!this.paused)
      throw Error("Parser was already resumed");
    if (this.paused = !1, this.inLoop)
      return;
    if (this._runParsingLoop(), !this.paused)
      e === null || e === void 0 || e();
  }
  write(e, t, u) {
    if (this.active = !0, this.preprocessor.write(e, t), this._runParsingLoop(), !this.paused)
      u === null || u === void 0 || u();
  }
  insertHtmlAtCurrentPos(e) {
    this.active = !0, this.preprocessor.insertHtmlAtCurrentPos(e), this._runParsingLoop();
  }
  _ensureHibernation() {
    if (this.preprocessor.endOfChunkHit)
      return this.preprocessor.retreat(this.consumedAfterSnapshot), this.consumedAfterSnapshot = 0, this.active = !1, !0;
    return !1;
  }
  _consume() {
    return this.consumedAfterSnapshot++, this.preprocessor.advance();
  }
  _advanceBy(e) {
    this.consumedAfterSnapshot += e;
    for (let t = 0;t < e; t++)
      this.preprocessor.advance();
  }
  _consumeSequenceIfMatch(e, t) {
    if (this.preprocessor.startsWith(e, t))
      return this._advanceBy(e.length - 1), !0;
    return !1;
  }
  _createStartTagToken() {
    this.currentToken = {
      type: B.START_TAG,
      tagName: "",
      tagID: r.UNKNOWN,
      selfClosing: !1,
      ackSelfClosing: !1,
      attrs: [],
      location: this.getCurrentLocation(1)
    };
  }
  _createEndTagToken() {
    this.currentToken = {
      type: B.END_TAG,
      tagName: "",
      tagID: r.UNKNOWN,
      selfClosing: !1,
      ackSelfClosing: !1,
      attrs: [],
      location: this.getCurrentLocation(2)
    };
  }
  _createCommentToken(e) {
    this.currentToken = {
      type: B.COMMENT,
      data: "",
      location: this.getCurrentLocation(e)
    };
  }
  _createDoctypeToken(e) {
    this.currentToken = {
      type: B.DOCTYPE,
      name: e,
      forceQuirks: !1,
      publicId: null,
      systemId: null,
      location: this.currentLocation
    };
  }
  _createCharacterToken(e, t) {
    this.currentCharacterToken = {
      type: e,
      chars: t,
      location: this.currentLocation
    };
  }
  _createAttr(e) {
    this.currentAttr = {
      name: e,
      value: ""
    }, this.currentLocation = this.getCurrentLocation(0);
  }
  _leaveAttrName() {
    var e, t;
    let u = this.currentToken;
    if (au(u, this.currentAttr.name) === null) {
      if (u.attrs.push(this.currentAttr), u.location && this.currentLocation) {
        let s = (e = (t = u.location).attrs) !== null && e !== void 0 ? e : t.attrs = Object.create(null);
        s[this.currentAttr.name] = this.currentLocation, this._leaveAttrValue();
      }
    } else
      this._err(E.duplicateAttribute);
  }
  _leaveAttrValue() {
    if (this.currentLocation)
      this.currentLocation.endLine = this.preprocessor.line, this.currentLocation.endCol = this.preprocessor.col, this.currentLocation.endOffset = this.preprocessor.offset;
  }
  prepareToken(e) {
    if (this._emitCurrentCharacterToken(e.location), this.currentToken = null, e.location)
      e.location.endLine = this.preprocessor.line, e.location.endCol = this.preprocessor.col + 1, e.location.endOffset = this.preprocessor.offset + 1;
    this.currentLocation = this.getCurrentLocation(-1);
  }
  emitCurrentTagToken() {
    let e = this.currentToken;
    if (this.prepareToken(e), e.tagID = we(e.tagName), e.type === B.START_TAG)
      this.lastStartTagName = e.tagName, this.handler.onStartTag(e);
    else {
      if (e.attrs.length > 0)
        this._err(E.endTagWithAttributes);
      if (e.selfClosing)
        this._err(E.endTagWithTrailingSolidus);
      this.handler.onEndTag(e);
    }
    this.preprocessor.dropParsedChunk();
  }
  emitCurrentComment(e) {
    this.prepareToken(e), this.handler.onComment(e), this.preprocessor.dropParsedChunk();
  }
  emitCurrentDoctype(e) {
    this.prepareToken(e), this.handler.onDoctype(e), this.preprocessor.dropParsedChunk();
  }
  _emitCurrentCharacterToken(e) {
    if (this.currentCharacterToken) {
      if (e && this.currentCharacterToken.location)
        this.currentCharacterToken.location.endLine = e.startLine, this.currentCharacterToken.location.endCol = e.startCol, this.currentCharacterToken.location.endOffset = e.startOffset;
      switch (this.currentCharacterToken.type) {
        case B.CHARACTER: {
          this.handler.onCharacter(this.currentCharacterToken);
          break;
        }
        case B.NULL_CHARACTER: {
          this.handler.onNullCharacter(this.currentCharacterToken);
          break;
        }
        case B.WHITESPACE_CHARACTER: {
          this.handler.onWhitespaceCharacter(this.currentCharacterToken);
          break;
        }
      }
      this.currentCharacterToken = null;
    }
  }
  _emitEOFToken() {
    let e = this.getCurrentLocation(0);
    if (e)
      e.endLine = e.startLine, e.endCol = e.startCol, e.endOffset = e.startOffset;
    this._emitCurrentCharacterToken(e), this.handler.onEof({ type: B.EOF, location: e }), this.active = !1;
  }
  _appendCharToCurrentCharacterToken(e, t) {
    if (this.currentCharacterToken)
      if (this.currentCharacterToken.type === e) {
        this.currentCharacterToken.chars += t;
        return;
      } else
        this.currentLocation = this.getCurrentLocation(0), this._emitCurrentCharacterToken(this.currentLocation), this.preprocessor.dropParsedChunk();
    this._createCharacterToken(e, t);
  }
  _emitCodePoint(e) {
    let t = ci(e) ? B.WHITESPACE_CHARACTER : e === c.NULL ? B.NULL_CHARACTER : B.CHARACTER;
    this._appendCharToCurrentCharacterToken(t, String.fromCodePoint(e));
  }
  _emitChars(e) {
    this._appendCharToCurrentCharacterToken(B.CHARACTER, e);
  }
  _startCharacterReference() {
    this.returnState = this.state, this.state = A.CHARACTER_REFERENCE, this.entityStartPos = this.preprocessor.pos, this.entityDecoder.startEntity(this._isCharacterReferenceInAttribute() ? ae.Attribute : ae.Legacy);
  }
  _isCharacterReferenceInAttribute() {
    return this.returnState === A.ATTRIBUTE_VALUE_DOUBLE_QUOTED || this.returnState === A.ATTRIBUTE_VALUE_SINGLE_QUOTED || this.returnState === A.ATTRIBUTE_VALUE_UNQUOTED;
  }
  _flushCodePointConsumedAsCharacterReference(e) {
    if (this._isCharacterReferenceInAttribute())
      this.currentAttr.value += String.fromCodePoint(e);
    else
      this._emitCodePoint(e);
  }
  _callState(e) {
    switch (this.state) {
      case A.DATA: {
        this._stateData(e);
        break;
      }
      case A.RCDATA: {
        this._stateRcdata(e);
        break;
      }
      case A.RAWTEXT: {
        this._stateRawtext(e);
        break;
      }
      case A.SCRIPT_DATA: {
        this._stateScriptData(e);
        break;
      }
      case A.PLAINTEXT: {
        this._statePlaintext(e);
        break;
      }
      case A.TAG_OPEN: {
        this._stateTagOpen(e);
        break;
      }
      case A.END_TAG_OPEN: {
        this._stateEndTagOpen(e);
        break;
      }
      case A.TAG_NAME: {
        this._stateTagName(e);
        break;
      }
      case A.RCDATA_LESS_THAN_SIGN: {
        this._stateRcdataLessThanSign(e);
        break;
      }
      case A.RCDATA_END_TAG_OPEN: {
        this._stateRcdataEndTagOpen(e);
        break;
      }
      case A.RCDATA_END_TAG_NAME: {
        this._stateRcdataEndTagName(e);
        break;
      }
      case A.RAWTEXT_LESS_THAN_SIGN: {
        this._stateRawtextLessThanSign(e);
        break;
      }
      case A.RAWTEXT_END_TAG_OPEN: {
        this._stateRawtextEndTagOpen(e);
        break;
      }
      case A.RAWTEXT_END_TAG_NAME: {
        this._stateRawtextEndTagName(e);
        break;
      }
      case A.SCRIPT_DATA_LESS_THAN_SIGN: {
        this._stateScriptDataLessThanSign(e);
        break;
      }
      case A.SCRIPT_DATA_END_TAG_OPEN: {
        this._stateScriptDataEndTagOpen(e);
        break;
      }
      case A.SCRIPT_DATA_END_TAG_NAME: {
        this._stateScriptDataEndTagName(e);
        break;
      }
      case A.SCRIPT_DATA_ESCAPE_START: {
        this._stateScriptDataEscapeStart(e);
        break;
      }
      case A.SCRIPT_DATA_ESCAPE_START_DASH: {
        this._stateScriptDataEscapeStartDash(e);
        break;
      }
      case A.SCRIPT_DATA_ESCAPED: {
        this._stateScriptDataEscaped(e);
        break;
      }
      case A.SCRIPT_DATA_ESCAPED_DASH: {
        this._stateScriptDataEscapedDash(e);
        break;
      }
      case A.SCRIPT_DATA_ESCAPED_DASH_DASH: {
        this._stateScriptDataEscapedDashDash(e);
        break;
      }
      case A.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN: {
        this._stateScriptDataEscapedLessThanSign(e);
        break;
      }
      case A.SCRIPT_DATA_ESCAPED_END_TAG_OPEN: {
        this._stateScriptDataEscapedEndTagOpen(e);
        break;
      }
      case A.SCRIPT_DATA_ESCAPED_END_TAG_NAME: {
        this._stateScriptDataEscapedEndTagName(e);
        break;
      }
      case A.SCRIPT_DATA_DOUBLE_ESCAPE_START: {
        this._stateScriptDataDoubleEscapeStart(e);
        break;
      }
      case A.SCRIPT_DATA_DOUBLE_ESCAPED: {
        this._stateScriptDataDoubleEscaped(e);
        break;
      }
      case A.SCRIPT_DATA_DOUBLE_ESCAPED_DASH: {
        this._stateScriptDataDoubleEscapedDash(e);
        break;
      }
      case A.SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH: {
        this._stateScriptDataDoubleEscapedDashDash(e);
        break;
      }
      case A.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN: {
        this._stateScriptDataDoubleEscapedLessThanSign(e);
        break;
      }
      case A.SCRIPT_DATA_DOUBLE_ESCAPE_END: {
        this._stateScriptDataDoubleEscapeEnd(e);
        break;
      }
      case A.BEFORE_ATTRIBUTE_NAME: {
        this._stateBeforeAttributeName(e);
        break;
      }
      case A.ATTRIBUTE_NAME: {
        this._stateAttributeName(e);
        break;
      }
      case A.AFTER_ATTRIBUTE_NAME: {
        this._stateAfterAttributeName(e);
        break;
      }
      case A.BEFORE_ATTRIBUTE_VALUE: {
        this._stateBeforeAttributeValue(e);
        break;
      }
      case A.ATTRIBUTE_VALUE_DOUBLE_QUOTED: {
        this._stateAttributeValueDoubleQuoted(e);
        break;
      }
      case A.ATTRIBUTE_VALUE_SINGLE_QUOTED: {
        this._stateAttributeValueSingleQuoted(e);
        break;
      }
      case A.ATTRIBUTE_VALUE_UNQUOTED: {
        this._stateAttributeValueUnquoted(e);
        break;
      }
      case A.AFTER_ATTRIBUTE_VALUE_QUOTED: {
        this._stateAfterAttributeValueQuoted(e);
        break;
      }
      case A.SELF_CLOSING_START_TAG: {
        this._stateSelfClosingStartTag(e);
        break;
      }
      case A.BOGUS_COMMENT: {
        this._stateBogusComment(e);
        break;
      }
      case A.MARKUP_DECLARATION_OPEN: {
        this._stateMarkupDeclarationOpen(e);
        break;
      }
      case A.COMMENT_START: {
        this._stateCommentStart(e);
        break;
      }
      case A.COMMENT_START_DASH: {
        this._stateCommentStartDash(e);
        break;
      }
      case A.COMMENT: {
        this._stateComment(e);
        break;
      }
      case A.COMMENT_LESS_THAN_SIGN: {
        this._stateCommentLessThanSign(e);
        break;
      }
      case A.COMMENT_LESS_THAN_SIGN_BANG: {
        this._stateCommentLessThanSignBang(e);
        break;
      }
      case A.COMMENT_LESS_THAN_SIGN_BANG_DASH: {
        this._stateCommentLessThanSignBangDash(e);
        break;
      }
      case A.COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH: {
        this._stateCommentLessThanSignBangDashDash(e);
        break;
      }
      case A.COMMENT_END_DASH: {
        this._stateCommentEndDash(e);
        break;
      }
      case A.COMMENT_END: {
        this._stateCommentEnd(e);
        break;
      }
      case A.COMMENT_END_BANG: {
        this._stateCommentEndBang(e);
        break;
      }
      case A.DOCTYPE: {
        this._stateDoctype(e);
        break;
      }
      case A.BEFORE_DOCTYPE_NAME: {
        this._stateBeforeDoctypeName(e);
        break;
      }
      case A.DOCTYPE_NAME: {
        this._stateDoctypeName(e);
        break;
      }
      case A.AFTER_DOCTYPE_NAME: {
        this._stateAfterDoctypeName(e);
        break;
      }
      case A.AFTER_DOCTYPE_PUBLIC_KEYWORD: {
        this._stateAfterDoctypePublicKeyword(e);
        break;
      }
      case A.BEFORE_DOCTYPE_PUBLIC_IDENTIFIER: {
        this._stateBeforeDoctypePublicIdentifier(e);
        break;
      }
      case A.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED: {
        this._stateDoctypePublicIdentifierDoubleQuoted(e);
        break;
      }
      case A.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED: {
        this._stateDoctypePublicIdentifierSingleQuoted(e);
        break;
      }
      case A.AFTER_DOCTYPE_PUBLIC_IDENTIFIER: {
        this._stateAfterDoctypePublicIdentifier(e);
        break;
      }
      case A.BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS: {
        this._stateBetweenDoctypePublicAndSystemIdentifiers(e);
        break;
      }
      case A.AFTER_DOCTYPE_SYSTEM_KEYWORD: {
        this._stateAfterDoctypeSystemKeyword(e);
        break;
      }
      case A.BEFORE_DOCTYPE_SYSTEM_IDENTIFIER: {
        this._stateBeforeDoctypeSystemIdentifier(e);
        break;
      }
      case A.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED: {
        this._stateDoctypeSystemIdentifierDoubleQuoted(e);
        break;
      }
      case A.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED: {
        this._stateDoctypeSystemIdentifierSingleQuoted(e);
        break;
      }
      case A.AFTER_DOCTYPE_SYSTEM_IDENTIFIER: {
        this._stateAfterDoctypeSystemIdentifier(e);
        break;
      }
      case A.BOGUS_DOCTYPE: {
        this._stateBogusDoctype(e);
        break;
      }
      case A.CDATA_SECTION: {
        this._stateCdataSection(e);
        break;
      }
      case A.CDATA_SECTION_BRACKET: {
        this._stateCdataSectionBracket(e);
        break;
      }
      case A.CDATA_SECTION_END: {
        this._stateCdataSectionEnd(e);
        break;
      }
      case A.CHARACTER_REFERENCE: {
        this._stateCharacterReference();
        break;
      }
      case A.AMBIGUOUS_AMPERSAND: {
        this._stateAmbiguousAmpersand(e);
        break;
      }
      default:
        throw Error("Unknown state");
    }
  }
  _stateData(e) {
    switch (e) {
      case c.LESS_THAN_SIGN: {
        this.state = A.TAG_OPEN;
        break;
      }
      case c.AMPERSAND: {
        this._startCharacterReference();
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this._emitCodePoint(e);
        break;
      }
      case c.EOF: {
        this._emitEOFToken();
        break;
      }
      default:
        this._emitCodePoint(e);
    }
  }
  _stateRcdata(e) {
    switch (e) {
      case c.AMPERSAND: {
        this._startCharacterReference();
        break;
      }
      case c.LESS_THAN_SIGN: {
        this.state = A.RCDATA_LESS_THAN_SIGN;
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this._emitChars(y);
        break;
      }
      case c.EOF: {
        this._emitEOFToken();
        break;
      }
      default:
        this._emitCodePoint(e);
    }
  }
  _stateRawtext(e) {
    switch (e) {
      case c.LESS_THAN_SIGN: {
        this.state = A.RAWTEXT_LESS_THAN_SIGN;
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this._emitChars(y);
        break;
      }
      case c.EOF: {
        this._emitEOFToken();
        break;
      }
      default:
        this._emitCodePoint(e);
    }
  }
  _stateScriptData(e) {
    switch (e) {
      case c.LESS_THAN_SIGN: {
        this.state = A.SCRIPT_DATA_LESS_THAN_SIGN;
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this._emitChars(y);
        break;
      }
      case c.EOF: {
        this._emitEOFToken();
        break;
      }
      default:
        this._emitCodePoint(e);
    }
  }
  _statePlaintext(e) {
    switch (e) {
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this._emitChars(y);
        break;
      }
      case c.EOF: {
        this._emitEOFToken();
        break;
      }
      default:
        this._emitCodePoint(e);
    }
  }
  _stateTagOpen(e) {
    if (Se(e))
      this._createStartTagToken(), this.state = A.TAG_NAME, this._stateTagName(e);
    else
      switch (e) {
        case c.EXCLAMATION_MARK: {
          this.state = A.MARKUP_DECLARATION_OPEN;
          break;
        }
        case c.SOLIDUS: {
          this.state = A.END_TAG_OPEN;
          break;
        }
        case c.QUESTION_MARK: {
          this._err(E.unexpectedQuestionMarkInsteadOfTagName), this._createCommentToken(1), this.state = A.BOGUS_COMMENT, this._stateBogusComment(e);
          break;
        }
        case c.EOF: {
          this._err(E.eofBeforeTagName), this._emitChars("<"), this._emitEOFToken();
          break;
        }
        default:
          this._err(E.invalidFirstCharacterOfTagName), this._emitChars("<"), this.state = A.DATA, this._stateData(e);
      }
  }
  _stateEndTagOpen(e) {
    if (Se(e))
      this._createEndTagToken(), this.state = A.TAG_NAME, this._stateTagName(e);
    else
      switch (e) {
        case c.GREATER_THAN_SIGN: {
          this._err(E.missingEndTagName), this.state = A.DATA;
          break;
        }
        case c.EOF: {
          this._err(E.eofBeforeTagName), this._emitChars("</"), this._emitEOFToken();
          break;
        }
        default:
          this._err(E.invalidFirstCharacterOfTagName), this._createCommentToken(2), this.state = A.BOGUS_COMMENT, this._stateBogusComment(e);
      }
  }
  _stateTagName(e) {
    let t = this.currentToken;
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED: {
        this.state = A.BEFORE_ATTRIBUTE_NAME;
        break;
      }
      case c.SOLIDUS: {
        this.state = A.SELF_CLOSING_START_TAG;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this.state = A.DATA, this.emitCurrentTagToken();
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), t.tagName += y;
        break;
      }
      case c.EOF: {
        this._err(E.eofInTag), this._emitEOFToken();
        break;
      }
      default:
        t.tagName += String.fromCodePoint(Et(e) ? cu(e) : e);
    }
  }
  _stateRcdataLessThanSign(e) {
    if (e === c.SOLIDUS)
      this.state = A.RCDATA_END_TAG_OPEN;
    else
      this._emitChars("<"), this.state = A.RCDATA, this._stateRcdata(e);
  }
  _stateRcdataEndTagOpen(e) {
    if (Se(e))
      this.state = A.RCDATA_END_TAG_NAME, this._stateRcdataEndTagName(e);
    else
      this._emitChars("</"), this.state = A.RCDATA, this._stateRcdata(e);
  }
  handleSpecialEndTag(e) {
    if (!this.preprocessor.startsWith(this.lastStartTagName, !1))
      return !this._ensureHibernation();
    this._createEndTagToken();
    let t = this.currentToken;
    switch (t.tagName = this.lastStartTagName, this.preprocessor.peek(this.lastStartTagName.length)) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED:
        return this._advanceBy(this.lastStartTagName.length), this.state = A.BEFORE_ATTRIBUTE_NAME, !1;
      case c.SOLIDUS:
        return this._advanceBy(this.lastStartTagName.length), this.state = A.SELF_CLOSING_START_TAG, !1;
      case c.GREATER_THAN_SIGN:
        return this._advanceBy(this.lastStartTagName.length), this.emitCurrentTagToken(), this.state = A.DATA, !1;
      default:
        return !this._ensureHibernation();
    }
  }
  _stateRcdataEndTagName(e) {
    if (this.handleSpecialEndTag(e))
      this._emitChars("</"), this.state = A.RCDATA, this._stateRcdata(e);
  }
  _stateRawtextLessThanSign(e) {
    if (e === c.SOLIDUS)
      this.state = A.RAWTEXT_END_TAG_OPEN;
    else
      this._emitChars("<"), this.state = A.RAWTEXT, this._stateRawtext(e);
  }
  _stateRawtextEndTagOpen(e) {
    if (Se(e))
      this.state = A.RAWTEXT_END_TAG_NAME, this._stateRawtextEndTagName(e);
    else
      this._emitChars("</"), this.state = A.RAWTEXT, this._stateRawtext(e);
  }
  _stateRawtextEndTagName(e) {
    if (this.handleSpecialEndTag(e))
      this._emitChars("</"), this.state = A.RAWTEXT, this._stateRawtext(e);
  }
  _stateScriptDataLessThanSign(e) {
    switch (e) {
      case c.SOLIDUS: {
        this.state = A.SCRIPT_DATA_END_TAG_OPEN;
        break;
      }
      case c.EXCLAMATION_MARK: {
        this.state = A.SCRIPT_DATA_ESCAPE_START, this._emitChars("<!");
        break;
      }
      default:
        this._emitChars("<"), this.state = A.SCRIPT_DATA, this._stateScriptData(e);
    }
  }
  _stateScriptDataEndTagOpen(e) {
    if (Se(e))
      this.state = A.SCRIPT_DATA_END_TAG_NAME, this._stateScriptDataEndTagName(e);
    else
      this._emitChars("</"), this.state = A.SCRIPT_DATA, this._stateScriptData(e);
  }
  _stateScriptDataEndTagName(e) {
    if (this.handleSpecialEndTag(e))
      this._emitChars("</"), this.state = A.SCRIPT_DATA, this._stateScriptData(e);
  }
  _stateScriptDataEscapeStart(e) {
    if (e === c.HYPHEN_MINUS)
      this.state = A.SCRIPT_DATA_ESCAPE_START_DASH, this._emitChars("-");
    else
      this.state = A.SCRIPT_DATA, this._stateScriptData(e);
  }
  _stateScriptDataEscapeStartDash(e) {
    if (e === c.HYPHEN_MINUS)
      this.state = A.SCRIPT_DATA_ESCAPED_DASH_DASH, this._emitChars("-");
    else
      this.state = A.SCRIPT_DATA, this._stateScriptData(e);
  }
  _stateScriptDataEscaped(e) {
    switch (e) {
      case c.HYPHEN_MINUS: {
        this.state = A.SCRIPT_DATA_ESCAPED_DASH, this._emitChars("-");
        break;
      }
      case c.LESS_THAN_SIGN: {
        this.state = A.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN;
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this._emitChars(y);
        break;
      }
      case c.EOF: {
        this._err(E.eofInScriptHtmlCommentLikeText), this._emitEOFToken();
        break;
      }
      default:
        this._emitCodePoint(e);
    }
  }
  _stateScriptDataEscapedDash(e) {
    switch (e) {
      case c.HYPHEN_MINUS: {
        this.state = A.SCRIPT_DATA_ESCAPED_DASH_DASH, this._emitChars("-");
        break;
      }
      case c.LESS_THAN_SIGN: {
        this.state = A.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN;
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this.state = A.SCRIPT_DATA_ESCAPED, this._emitChars(y);
        break;
      }
      case c.EOF: {
        this._err(E.eofInScriptHtmlCommentLikeText), this._emitEOFToken();
        break;
      }
      default:
        this.state = A.SCRIPT_DATA_ESCAPED, this._emitCodePoint(e);
    }
  }
  _stateScriptDataEscapedDashDash(e) {
    switch (e) {
      case c.HYPHEN_MINUS: {
        this._emitChars("-");
        break;
      }
      case c.LESS_THAN_SIGN: {
        this.state = A.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this.state = A.SCRIPT_DATA, this._emitChars(">");
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this.state = A.SCRIPT_DATA_ESCAPED, this._emitChars(y);
        break;
      }
      case c.EOF: {
        this._err(E.eofInScriptHtmlCommentLikeText), this._emitEOFToken();
        break;
      }
      default:
        this.state = A.SCRIPT_DATA_ESCAPED, this._emitCodePoint(e);
    }
  }
  _stateScriptDataEscapedLessThanSign(e) {
    if (e === c.SOLIDUS)
      this.state = A.SCRIPT_DATA_ESCAPED_END_TAG_OPEN;
    else if (Se(e))
      this._emitChars("<"), this.state = A.SCRIPT_DATA_DOUBLE_ESCAPE_START, this._stateScriptDataDoubleEscapeStart(e);
    else
      this._emitChars("<"), this.state = A.SCRIPT_DATA_ESCAPED, this._stateScriptDataEscaped(e);
  }
  _stateScriptDataEscapedEndTagOpen(e) {
    if (Se(e))
      this.state = A.SCRIPT_DATA_ESCAPED_END_TAG_NAME, this._stateScriptDataEscapedEndTagName(e);
    else
      this._emitChars("</"), this.state = A.SCRIPT_DATA_ESCAPED, this._stateScriptDataEscaped(e);
  }
  _stateScriptDataEscapedEndTagName(e) {
    if (this.handleSpecialEndTag(e))
      this._emitChars("</"), this.state = A.SCRIPT_DATA_ESCAPED, this._stateScriptDataEscaped(e);
  }
  _stateScriptDataDoubleEscapeStart(e) {
    if (this.preprocessor.startsWith(K.SCRIPT, !1) && ai(this.preprocessor.peek(K.SCRIPT.length))) {
      this._emitCodePoint(e);
      for (let t = 0;t < K.SCRIPT.length; t++)
        this._emitCodePoint(this._consume());
      this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED;
    } else if (!this._ensureHibernation())
      this.state = A.SCRIPT_DATA_ESCAPED, this._stateScriptDataEscaped(e);
  }
  _stateScriptDataDoubleEscaped(e) {
    switch (e) {
      case c.HYPHEN_MINUS: {
        this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED_DASH, this._emitChars("-");
        break;
      }
      case c.LESS_THAN_SIGN: {
        this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN, this._emitChars("<");
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this._emitChars(y);
        break;
      }
      case c.EOF: {
        this._err(E.eofInScriptHtmlCommentLikeText), this._emitEOFToken();
        break;
      }
      default:
        this._emitCodePoint(e);
    }
  }
  _stateScriptDataDoubleEscapedDash(e) {
    switch (e) {
      case c.HYPHEN_MINUS: {
        this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH, this._emitChars("-");
        break;
      }
      case c.LESS_THAN_SIGN: {
        this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN, this._emitChars("<");
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED, this._emitChars(y);
        break;
      }
      case c.EOF: {
        this._err(E.eofInScriptHtmlCommentLikeText), this._emitEOFToken();
        break;
      }
      default:
        this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED, this._emitCodePoint(e);
    }
  }
  _stateScriptDataDoubleEscapedDashDash(e) {
    switch (e) {
      case c.HYPHEN_MINUS: {
        this._emitChars("-");
        break;
      }
      case c.LESS_THAN_SIGN: {
        this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN, this._emitChars("<");
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this.state = A.SCRIPT_DATA, this._emitChars(">");
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED, this._emitChars(y);
        break;
      }
      case c.EOF: {
        this._err(E.eofInScriptHtmlCommentLikeText), this._emitEOFToken();
        break;
      }
      default:
        this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED, this._emitCodePoint(e);
    }
  }
  _stateScriptDataDoubleEscapedLessThanSign(e) {
    if (e === c.SOLIDUS)
      this.state = A.SCRIPT_DATA_DOUBLE_ESCAPE_END, this._emitChars("/");
    else
      this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED, this._stateScriptDataDoubleEscaped(e);
  }
  _stateScriptDataDoubleEscapeEnd(e) {
    if (this.preprocessor.startsWith(K.SCRIPT, !1) && ai(this.preprocessor.peek(K.SCRIPT.length))) {
      this._emitCodePoint(e);
      for (let t = 0;t < K.SCRIPT.length; t++)
        this._emitCodePoint(this._consume());
      this.state = A.SCRIPT_DATA_ESCAPED;
    } else if (!this._ensureHibernation())
      this.state = A.SCRIPT_DATA_DOUBLE_ESCAPED, this._stateScriptDataDoubleEscaped(e);
  }
  _stateBeforeAttributeName(e) {
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED:
        break;
      case c.SOLIDUS:
      case c.GREATER_THAN_SIGN:
      case c.EOF: {
        this.state = A.AFTER_ATTRIBUTE_NAME, this._stateAfterAttributeName(e);
        break;
      }
      case c.EQUALS_SIGN: {
        this._err(E.unexpectedEqualsSignBeforeAttributeName), this._createAttr("="), this.state = A.ATTRIBUTE_NAME;
        break;
      }
      default:
        this._createAttr(""), this.state = A.ATTRIBUTE_NAME, this._stateAttributeName(e);
    }
  }
  _stateAttributeName(e) {
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED:
      case c.SOLIDUS:
      case c.GREATER_THAN_SIGN:
      case c.EOF: {
        this._leaveAttrName(), this.state = A.AFTER_ATTRIBUTE_NAME, this._stateAfterAttributeName(e);
        break;
      }
      case c.EQUALS_SIGN: {
        this._leaveAttrName(), this.state = A.BEFORE_ATTRIBUTE_VALUE;
        break;
      }
      case c.QUOTATION_MARK:
      case c.APOSTROPHE:
      case c.LESS_THAN_SIGN: {
        this._err(E.unexpectedCharacterInAttributeName), this.currentAttr.name += String.fromCodePoint(e);
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this.currentAttr.name += y;
        break;
      }
      default:
        this.currentAttr.name += String.fromCodePoint(Et(e) ? cu(e) : e);
    }
  }
  _stateAfterAttributeName(e) {
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED:
        break;
      case c.SOLIDUS: {
        this.state = A.SELF_CLOSING_START_TAG;
        break;
      }
      case c.EQUALS_SIGN: {
        this.state = A.BEFORE_ATTRIBUTE_VALUE;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this.state = A.DATA, this.emitCurrentTagToken();
        break;
      }
      case c.EOF: {
        this._err(E.eofInTag), this._emitEOFToken();
        break;
      }
      default:
        this._createAttr(""), this.state = A.ATTRIBUTE_NAME, this._stateAttributeName(e);
    }
  }
  _stateBeforeAttributeValue(e) {
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED:
        break;
      case c.QUOTATION_MARK: {
        this.state = A.ATTRIBUTE_VALUE_DOUBLE_QUOTED;
        break;
      }
      case c.APOSTROPHE: {
        this.state = A.ATTRIBUTE_VALUE_SINGLE_QUOTED;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.missingAttributeValue), this.state = A.DATA, this.emitCurrentTagToken();
        break;
      }
      default:
        this.state = A.ATTRIBUTE_VALUE_UNQUOTED, this._stateAttributeValueUnquoted(e);
    }
  }
  _stateAttributeValueDoubleQuoted(e) {
    switch (e) {
      case c.QUOTATION_MARK: {
        this.state = A.AFTER_ATTRIBUTE_VALUE_QUOTED;
        break;
      }
      case c.AMPERSAND: {
        this._startCharacterReference();
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this.currentAttr.value += y;
        break;
      }
      case c.EOF: {
        this._err(E.eofInTag), this._emitEOFToken();
        break;
      }
      default:
        this.currentAttr.value += String.fromCodePoint(e);
    }
  }
  _stateAttributeValueSingleQuoted(e) {
    switch (e) {
      case c.APOSTROPHE: {
        this.state = A.AFTER_ATTRIBUTE_VALUE_QUOTED;
        break;
      }
      case c.AMPERSAND: {
        this._startCharacterReference();
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this.currentAttr.value += y;
        break;
      }
      case c.EOF: {
        this._err(E.eofInTag), this._emitEOFToken();
        break;
      }
      default:
        this.currentAttr.value += String.fromCodePoint(e);
    }
  }
  _stateAttributeValueUnquoted(e) {
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED: {
        this._leaveAttrValue(), this.state = A.BEFORE_ATTRIBUTE_NAME;
        break;
      }
      case c.AMPERSAND: {
        this._startCharacterReference();
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._leaveAttrValue(), this.state = A.DATA, this.emitCurrentTagToken();
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), this.currentAttr.value += y;
        break;
      }
      case c.QUOTATION_MARK:
      case c.APOSTROPHE:
      case c.LESS_THAN_SIGN:
      case c.EQUALS_SIGN:
      case c.GRAVE_ACCENT: {
        this._err(E.unexpectedCharacterInUnquotedAttributeValue), this.currentAttr.value += String.fromCodePoint(e);
        break;
      }
      case c.EOF: {
        this._err(E.eofInTag), this._emitEOFToken();
        break;
      }
      default:
        this.currentAttr.value += String.fromCodePoint(e);
    }
  }
  _stateAfterAttributeValueQuoted(e) {
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED: {
        this._leaveAttrValue(), this.state = A.BEFORE_ATTRIBUTE_NAME;
        break;
      }
      case c.SOLIDUS: {
        this._leaveAttrValue(), this.state = A.SELF_CLOSING_START_TAG;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._leaveAttrValue(), this.state = A.DATA, this.emitCurrentTagToken();
        break;
      }
      case c.EOF: {
        this._err(E.eofInTag), this._emitEOFToken();
        break;
      }
      default:
        this._err(E.missingWhitespaceBetweenAttributes), this.state = A.BEFORE_ATTRIBUTE_NAME, this._stateBeforeAttributeName(e);
    }
  }
  _stateSelfClosingStartTag(e) {
    switch (e) {
      case c.GREATER_THAN_SIGN: {
        let t = this.currentToken;
        t.selfClosing = !0, this.state = A.DATA, this.emitCurrentTagToken();
        break;
      }
      case c.EOF: {
        this._err(E.eofInTag), this._emitEOFToken();
        break;
      }
      default:
        this._err(E.unexpectedSolidusInTag), this.state = A.BEFORE_ATTRIBUTE_NAME, this._stateBeforeAttributeName(e);
    }
  }
  _stateBogusComment(e) {
    let t = this.currentToken;
    switch (e) {
      case c.GREATER_THAN_SIGN: {
        this.state = A.DATA, this.emitCurrentComment(t);
        break;
      }
      case c.EOF: {
        this.emitCurrentComment(t), this._emitEOFToken();
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), t.data += y;
        break;
      }
      default:
        t.data += String.fromCodePoint(e);
    }
  }
  _stateMarkupDeclarationOpen(e) {
    if (this._consumeSequenceIfMatch(K.DASH_DASH, !0))
      this._createCommentToken(K.DASH_DASH.length + 1), this.state = A.COMMENT_START;
    else if (this._consumeSequenceIfMatch(K.DOCTYPE, !1))
      this.currentLocation = this.getCurrentLocation(K.DOCTYPE.length + 1), this.state = A.DOCTYPE;
    else if (this._consumeSequenceIfMatch(K.CDATA_START, !0))
      if (this.inForeignNode)
        this.state = A.CDATA_SECTION;
      else
        this._err(E.cdataInHtmlContent), this._createCommentToken(K.CDATA_START.length + 1), this.currentToken.data = "[CDATA[", this.state = A.BOGUS_COMMENT;
    else if (!this._ensureHibernation())
      this._err(E.incorrectlyOpenedComment), this._createCommentToken(2), this.state = A.BOGUS_COMMENT, this._stateBogusComment(e);
  }
  _stateCommentStart(e) {
    switch (e) {
      case c.HYPHEN_MINUS: {
        this.state = A.COMMENT_START_DASH;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.abruptClosingOfEmptyComment), this.state = A.DATA;
        let t = this.currentToken;
        this.emitCurrentComment(t);
        break;
      }
      default:
        this.state = A.COMMENT, this._stateComment(e);
    }
  }
  _stateCommentStartDash(e) {
    let t = this.currentToken;
    switch (e) {
      case c.HYPHEN_MINUS: {
        this.state = A.COMMENT_END;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.abruptClosingOfEmptyComment), this.state = A.DATA, this.emitCurrentComment(t);
        break;
      }
      case c.EOF: {
        this._err(E.eofInComment), this.emitCurrentComment(t), this._emitEOFToken();
        break;
      }
      default:
        t.data += "-", this.state = A.COMMENT, this._stateComment(e);
    }
  }
  _stateComment(e) {
    let t = this.currentToken;
    switch (e) {
      case c.HYPHEN_MINUS: {
        this.state = A.COMMENT_END_DASH;
        break;
      }
      case c.LESS_THAN_SIGN: {
        t.data += "<", this.state = A.COMMENT_LESS_THAN_SIGN;
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), t.data += y;
        break;
      }
      case c.EOF: {
        this._err(E.eofInComment), this.emitCurrentComment(t), this._emitEOFToken();
        break;
      }
      default:
        t.data += String.fromCodePoint(e);
    }
  }
  _stateCommentLessThanSign(e) {
    let t = this.currentToken;
    switch (e) {
      case c.EXCLAMATION_MARK: {
        t.data += "!", this.state = A.COMMENT_LESS_THAN_SIGN_BANG;
        break;
      }
      case c.LESS_THAN_SIGN: {
        t.data += "<";
        break;
      }
      default:
        this.state = A.COMMENT, this._stateComment(e);
    }
  }
  _stateCommentLessThanSignBang(e) {
    if (e === c.HYPHEN_MINUS)
      this.state = A.COMMENT_LESS_THAN_SIGN_BANG_DASH;
    else
      this.state = A.COMMENT, this._stateComment(e);
  }
  _stateCommentLessThanSignBangDash(e) {
    if (e === c.HYPHEN_MINUS)
      this.state = A.COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH;
    else
      this.state = A.COMMENT_END_DASH, this._stateCommentEndDash(e);
  }
  _stateCommentLessThanSignBangDashDash(e) {
    if (e !== c.GREATER_THAN_SIGN && e !== c.EOF)
      this._err(E.nestedComment);
    this.state = A.COMMENT_END, this._stateCommentEnd(e);
  }
  _stateCommentEndDash(e) {
    let t = this.currentToken;
    switch (e) {
      case c.HYPHEN_MINUS: {
        this.state = A.COMMENT_END;
        break;
      }
      case c.EOF: {
        this._err(E.eofInComment), this.emitCurrentComment(t), this._emitEOFToken();
        break;
      }
      default:
        t.data += "-", this.state = A.COMMENT, this._stateComment(e);
    }
  }
  _stateCommentEnd(e) {
    let t = this.currentToken;
    switch (e) {
      case c.GREATER_THAN_SIGN: {
        this.state = A.DATA, this.emitCurrentComment(t);
        break;
      }
      case c.EXCLAMATION_MARK: {
        this.state = A.COMMENT_END_BANG;
        break;
      }
      case c.HYPHEN_MINUS: {
        t.data += "-";
        break;
      }
      case c.EOF: {
        this._err(E.eofInComment), this.emitCurrentComment(t), this._emitEOFToken();
        break;
      }
      default:
        t.data += "--", this.state = A.COMMENT, this._stateComment(e);
    }
  }
  _stateCommentEndBang(e) {
    let t = this.currentToken;
    switch (e) {
      case c.HYPHEN_MINUS: {
        t.data += "--!", this.state = A.COMMENT_END_DASH;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.incorrectlyClosedComment), this.state = A.DATA, this.emitCurrentComment(t);
        break;
      }
      case c.EOF: {
        this._err(E.eofInComment), this.emitCurrentComment(t), this._emitEOFToken();
        break;
      }
      default:
        t.data += "--!", this.state = A.COMMENT, this._stateComment(e);
    }
  }
  _stateDoctype(e) {
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED: {
        this.state = A.BEFORE_DOCTYPE_NAME;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this.state = A.BEFORE_DOCTYPE_NAME, this._stateBeforeDoctypeName(e);
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), this._createDoctypeToken(null);
        let t = this.currentToken;
        t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        this._err(E.missingWhitespaceBeforeDoctypeName), this.state = A.BEFORE_DOCTYPE_NAME, this._stateBeforeDoctypeName(e);
    }
  }
  _stateBeforeDoctypeName(e) {
    if (Et(e))
      this._createDoctypeToken(String.fromCharCode(cu(e))), this.state = A.DOCTYPE_NAME;
    else
      switch (e) {
        case c.SPACE:
        case c.LINE_FEED:
        case c.TABULATION:
        case c.FORM_FEED:
          break;
        case c.NULL: {
          this._err(E.unexpectedNullCharacter), this._createDoctypeToken(y), this.state = A.DOCTYPE_NAME;
          break;
        }
        case c.GREATER_THAN_SIGN: {
          this._err(E.missingDoctypeName), this._createDoctypeToken(null);
          let t = this.currentToken;
          t.forceQuirks = !0, this.emitCurrentDoctype(t), this.state = A.DATA;
          break;
        }
        case c.EOF: {
          this._err(E.eofInDoctype), this._createDoctypeToken(null);
          let t = this.currentToken;
          t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
          break;
        }
        default:
          this._createDoctypeToken(String.fromCodePoint(e)), this.state = A.DOCTYPE_NAME;
      }
  }
  _stateDoctypeName(e) {
    let t = this.currentToken;
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED: {
        this.state = A.AFTER_DOCTYPE_NAME;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this.state = A.DATA, this.emitCurrentDoctype(t);
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), t.name += y;
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        t.name += String.fromCodePoint(Et(e) ? cu(e) : e);
    }
  }
  _stateAfterDoctypeName(e) {
    let t = this.currentToken;
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED:
        break;
      case c.GREATER_THAN_SIGN: {
        this.state = A.DATA, this.emitCurrentDoctype(t);
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        if (this._consumeSequenceIfMatch(K.PUBLIC, !1))
          this.state = A.AFTER_DOCTYPE_PUBLIC_KEYWORD;
        else if (this._consumeSequenceIfMatch(K.SYSTEM, !1))
          this.state = A.AFTER_DOCTYPE_SYSTEM_KEYWORD;
        else if (!this._ensureHibernation())
          this._err(E.invalidCharacterSequenceAfterDoctypeName), t.forceQuirks = !0, this.state = A.BOGUS_DOCTYPE, this._stateBogusDoctype(e);
    }
  }
  _stateAfterDoctypePublicKeyword(e) {
    let t = this.currentToken;
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED: {
        this.state = A.BEFORE_DOCTYPE_PUBLIC_IDENTIFIER;
        break;
      }
      case c.QUOTATION_MARK: {
        this._err(E.missingWhitespaceAfterDoctypePublicKeyword), t.publicId = "", this.state = A.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case c.APOSTROPHE: {
        this._err(E.missingWhitespaceAfterDoctypePublicKeyword), t.publicId = "", this.state = A.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.missingDoctypePublicIdentifier), t.forceQuirks = !0, this.state = A.DATA, this.emitCurrentDoctype(t);
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        this._err(E.missingQuoteBeforeDoctypePublicIdentifier), t.forceQuirks = !0, this.state = A.BOGUS_DOCTYPE, this._stateBogusDoctype(e);
    }
  }
  _stateBeforeDoctypePublicIdentifier(e) {
    let t = this.currentToken;
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED:
        break;
      case c.QUOTATION_MARK: {
        t.publicId = "", this.state = A.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case c.APOSTROPHE: {
        t.publicId = "", this.state = A.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.missingDoctypePublicIdentifier), t.forceQuirks = !0, this.state = A.DATA, this.emitCurrentDoctype(t);
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        this._err(E.missingQuoteBeforeDoctypePublicIdentifier), t.forceQuirks = !0, this.state = A.BOGUS_DOCTYPE, this._stateBogusDoctype(e);
    }
  }
  _stateDoctypePublicIdentifierDoubleQuoted(e) {
    let t = this.currentToken;
    switch (e) {
      case c.QUOTATION_MARK: {
        this.state = A.AFTER_DOCTYPE_PUBLIC_IDENTIFIER;
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), t.publicId += y;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.abruptDoctypePublicIdentifier), t.forceQuirks = !0, this.emitCurrentDoctype(t), this.state = A.DATA;
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        t.publicId += String.fromCodePoint(e);
    }
  }
  _stateDoctypePublicIdentifierSingleQuoted(e) {
    let t = this.currentToken;
    switch (e) {
      case c.APOSTROPHE: {
        this.state = A.AFTER_DOCTYPE_PUBLIC_IDENTIFIER;
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), t.publicId += y;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.abruptDoctypePublicIdentifier), t.forceQuirks = !0, this.emitCurrentDoctype(t), this.state = A.DATA;
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        t.publicId += String.fromCodePoint(e);
    }
  }
  _stateAfterDoctypePublicIdentifier(e) {
    let t = this.currentToken;
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED: {
        this.state = A.BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this.state = A.DATA, this.emitCurrentDoctype(t);
        break;
      }
      case c.QUOTATION_MARK: {
        this._err(E.missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers), t.systemId = "", this.state = A.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case c.APOSTROPHE: {
        this._err(E.missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers), t.systemId = "", this.state = A.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        this._err(E.missingQuoteBeforeDoctypeSystemIdentifier), t.forceQuirks = !0, this.state = A.BOGUS_DOCTYPE, this._stateBogusDoctype(e);
    }
  }
  _stateBetweenDoctypePublicAndSystemIdentifiers(e) {
    let t = this.currentToken;
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED:
        break;
      case c.GREATER_THAN_SIGN: {
        this.emitCurrentDoctype(t), this.state = A.DATA;
        break;
      }
      case c.QUOTATION_MARK: {
        t.systemId = "", this.state = A.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case c.APOSTROPHE: {
        t.systemId = "", this.state = A.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        this._err(E.missingQuoteBeforeDoctypeSystemIdentifier), t.forceQuirks = !0, this.state = A.BOGUS_DOCTYPE, this._stateBogusDoctype(e);
    }
  }
  _stateAfterDoctypeSystemKeyword(e) {
    let t = this.currentToken;
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED: {
        this.state = A.BEFORE_DOCTYPE_SYSTEM_IDENTIFIER;
        break;
      }
      case c.QUOTATION_MARK: {
        this._err(E.missingWhitespaceAfterDoctypeSystemKeyword), t.systemId = "", this.state = A.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case c.APOSTROPHE: {
        this._err(E.missingWhitespaceAfterDoctypeSystemKeyword), t.systemId = "", this.state = A.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.missingDoctypeSystemIdentifier), t.forceQuirks = !0, this.state = A.DATA, this.emitCurrentDoctype(t);
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        this._err(E.missingQuoteBeforeDoctypeSystemIdentifier), t.forceQuirks = !0, this.state = A.BOGUS_DOCTYPE, this._stateBogusDoctype(e);
    }
  }
  _stateBeforeDoctypeSystemIdentifier(e) {
    let t = this.currentToken;
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED:
        break;
      case c.QUOTATION_MARK: {
        t.systemId = "", this.state = A.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case c.APOSTROPHE: {
        t.systemId = "", this.state = A.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.missingDoctypeSystemIdentifier), t.forceQuirks = !0, this.state = A.DATA, this.emitCurrentDoctype(t);
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        this._err(E.missingQuoteBeforeDoctypeSystemIdentifier), t.forceQuirks = !0, this.state = A.BOGUS_DOCTYPE, this._stateBogusDoctype(e);
    }
  }
  _stateDoctypeSystemIdentifierDoubleQuoted(e) {
    let t = this.currentToken;
    switch (e) {
      case c.QUOTATION_MARK: {
        this.state = A.AFTER_DOCTYPE_SYSTEM_IDENTIFIER;
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), t.systemId += y;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.abruptDoctypeSystemIdentifier), t.forceQuirks = !0, this.emitCurrentDoctype(t), this.state = A.DATA;
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        t.systemId += String.fromCodePoint(e);
    }
  }
  _stateDoctypeSystemIdentifierSingleQuoted(e) {
    let t = this.currentToken;
    switch (e) {
      case c.APOSTROPHE: {
        this.state = A.AFTER_DOCTYPE_SYSTEM_IDENTIFIER;
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter), t.systemId += y;
        break;
      }
      case c.GREATER_THAN_SIGN: {
        this._err(E.abruptDoctypeSystemIdentifier), t.forceQuirks = !0, this.emitCurrentDoctype(t), this.state = A.DATA;
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        t.systemId += String.fromCodePoint(e);
    }
  }
  _stateAfterDoctypeSystemIdentifier(e) {
    let t = this.currentToken;
    switch (e) {
      case c.SPACE:
      case c.LINE_FEED:
      case c.TABULATION:
      case c.FORM_FEED:
        break;
      case c.GREATER_THAN_SIGN: {
        this.emitCurrentDoctype(t), this.state = A.DATA;
        break;
      }
      case c.EOF: {
        this._err(E.eofInDoctype), t.forceQuirks = !0, this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
        this._err(E.unexpectedCharacterAfterDoctypeSystemIdentifier), this.state = A.BOGUS_DOCTYPE, this._stateBogusDoctype(e);
    }
  }
  _stateBogusDoctype(e) {
    let t = this.currentToken;
    switch (e) {
      case c.GREATER_THAN_SIGN: {
        this.emitCurrentDoctype(t), this.state = A.DATA;
        break;
      }
      case c.NULL: {
        this._err(E.unexpectedNullCharacter);
        break;
      }
      case c.EOF: {
        this.emitCurrentDoctype(t), this._emitEOFToken();
        break;
      }
      default:
    }
  }
  _stateCdataSection(e) {
    switch (e) {
      case c.RIGHT_SQUARE_BRACKET: {
        this.state = A.CDATA_SECTION_BRACKET;
        break;
      }
      case c.EOF: {
        this._err(E.eofInCdata), this._emitEOFToken();
        break;
      }
      default:
        this._emitCodePoint(e);
    }
  }
  _stateCdataSectionBracket(e) {
    if (e === c.RIGHT_SQUARE_BRACKET)
      this.state = A.CDATA_SECTION_END;
    else
      this._emitChars("]"), this.state = A.CDATA_SECTION, this._stateCdataSection(e);
  }
  _stateCdataSectionEnd(e) {
    switch (e) {
      case c.GREATER_THAN_SIGN: {
        this.state = A.DATA;
        break;
      }
      case c.RIGHT_SQUARE_BRACKET: {
        this._emitChars("]");
        break;
      }
      default:
        this._emitChars("]]"), this.state = A.CDATA_SECTION, this._stateCdataSection(e);
    }
  }
  _stateCharacterReference() {
    let e = this.entityDecoder.write(this.preprocessor.html, this.preprocessor.pos);
    if (e < 0)
      if (this.preprocessor.lastChunkWritten)
        e = this.entityDecoder.end();
      else {
        this.active = !1, this.preprocessor.pos = this.preprocessor.html.length - 1, this.consumedAfterSnapshot = 0, this.preprocessor.endOfChunkHit = !0;
        return;
      }
    if (e === 0)
      this.preprocessor.pos = this.entityStartPos, this._flushCodePointConsumedAsCharacterReference(c.AMPERSAND), this.state = !this._isCharacterReferenceInAttribute() && ni(this.preprocessor.peek(1)) ? A.AMBIGUOUS_AMPERSAND : this.returnState;
    else
      this.state = this.returnState;
  }
  _stateAmbiguousAmpersand(e) {
    if (ni(e))
      this._flushCodePointConsumedAsCharacterReference(e);
    else {
      if (e === c.SEMICOLON)
        this._err(E.unknownNamedCharacterReference);
      this.state = this.returnState, this._callState(e);
    }
  }
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/parser/open-element-stack.js
var li = /* @__PURE__ */ new Set([r.DD, r.DT, r.LI, r.OPTGROUP, r.OPTION, r.P, r.RB, r.RP, r.RT, r.RTC]), Ai = /* @__PURE__ */ new Set([
  ...li,
  r.CAPTION,
  r.COLGROUP,
  r.TBODY,
  r.TD,
  r.TFOOT,
  r.TH,
  r.THEAD,
  r.TR
]), ou = /* @__PURE__ */ new Set([
  r.APPLET,
  r.CAPTION,
  r.HTML,
  r.MARQUEE,
  r.OBJECT,
  r.TABLE,
  r.TD,
  r.TEMPLATE,
  r.TH
]), AA = /* @__PURE__ */ new Set([...ou, r.OL, r.UL]), oA = /* @__PURE__ */ new Set([...ou, r.BUTTON]), oi = /* @__PURE__ */ new Set([r.ANNOTATION_XML, r.MI, r.MN, r.MO, r.MS, r.MTEXT]), di = /* @__PURE__ */ new Set([r.DESC, r.FOREIGN_OBJECT, r.TITLE]), dA = /* @__PURE__ */ new Set([r.TR, r.TEMPLATE, r.HTML]), lA = /* @__PURE__ */ new Set([r.TBODY, r.TFOOT, r.THEAD, r.TEMPLATE, r.HTML]), hA = /* @__PURE__ */ new Set([r.TABLE, r.TEMPLATE, r.HTML]), fA = /* @__PURE__ */ new Set([r.TD, r.TH]);

class Ns {
  get currentTmplContentOrNode() {
    return this._isInTemplate() ? this.treeAdapter.getTemplateContent(this.current) : this.current;
  }
  constructor(e, t, u) {
    this.treeAdapter = t, this.handler = u, this.items = [], this.tagIDs = [], this.stackTop = -1, this.tmplCount = 0, this.currentTagId = r.UNKNOWN, this.current = e;
  }
  _indexOf(e) {
    return this.items.lastIndexOf(e, this.stackTop);
  }
  _isInTemplate() {
    return this.currentTagId === r.TEMPLATE && this.treeAdapter.getNamespaceURI(this.current) === m.HTML;
  }
  _updateCurrentElement() {
    this.current = this.items[this.stackTop], this.currentTagId = this.tagIDs[this.stackTop];
  }
  push(e, t) {
    if (this.stackTop++, this.items[this.stackTop] = e, this.current = e, this.tagIDs[this.stackTop] = t, this.currentTagId = t, this._isInTemplate())
      this.tmplCount++;
    this.handler.onItemPush(e, t, !0);
  }
  pop() {
    let e = this.current;
    if (this.tmplCount > 0 && this._isInTemplate())
      this.tmplCount--;
    this.stackTop--, this._updateCurrentElement(), this.handler.onItemPop(e, !0);
  }
  replace(e, t) {
    let u = this._indexOf(e);
    if (this.items[u] = t, u === this.stackTop)
      this.current = t;
  }
  insertAfter(e, t, u) {
    let s = this._indexOf(e) + 1;
    if (this.items.splice(s, 0, t), this.tagIDs.splice(s, 0, u), this.stackTop++, s === this.stackTop)
      this._updateCurrentElement();
    if (this.current && this.currentTagId !== void 0)
      this.handler.onItemPush(this.current, this.currentTagId, s === this.stackTop);
  }
  popUntilTagNamePopped(e) {
    let t = this.stackTop + 1;
    do
      t = this.tagIDs.lastIndexOf(e, t - 1);
    while (t > 0 && this.treeAdapter.getNamespaceURI(this.items[t]) !== m.HTML);
    this.shortenToLength(Math.max(t, 0));
  }
  shortenToLength(e) {
    while (this.stackTop >= e) {
      let t = this.current;
      if (this.tmplCount > 0 && this._isInTemplate())
        this.tmplCount -= 1;
      this.stackTop--, this._updateCurrentElement(), this.handler.onItemPop(t, this.stackTop < e);
    }
  }
  popUntilElementPopped(e) {
    let t = this._indexOf(e);
    this.shortenToLength(Math.max(t, 0));
  }
  popUntilPopped(e, t) {
    let u = this._indexOfTagNames(e, t);
    this.shortenToLength(Math.max(u, 0));
  }
  popUntilNumberedHeaderPopped() {
    this.popUntilPopped(ft, m.HTML);
  }
  popUntilTableCellPopped() {
    this.popUntilPopped(fA, m.HTML);
  }
  popAllUpToHtmlElement() {
    this.tmplCount = 0, this.shortenToLength(1);
  }
  _indexOfTagNames(e, t) {
    for (let u = this.stackTop;u >= 0; u--)
      if (e.has(this.tagIDs[u]) && this.treeAdapter.getNamespaceURI(this.items[u]) === t)
        return u;
    return -1;
  }
  clearBackTo(e, t) {
    let u = this._indexOfTagNames(e, t);
    this.shortenToLength(u + 1);
  }
  clearBackToTableContext() {
    this.clearBackTo(hA, m.HTML);
  }
  clearBackToTableBodyContext() {
    this.clearBackTo(lA, m.HTML);
  }
  clearBackToTableRowContext() {
    this.clearBackTo(dA, m.HTML);
  }
  remove(e) {
    let t = this._indexOf(e);
    if (t >= 0)
      if (t === this.stackTop)
        this.pop();
      else
        this.items.splice(t, 1), this.tagIDs.splice(t, 1), this.stackTop--, this._updateCurrentElement(), this.handler.onItemPop(e, !1);
  }
  tryPeekProperlyNestedBodyElement() {
    return this.stackTop >= 1 && this.tagIDs[1] === r.BODY ? this.items[1] : null;
  }
  contains(e) {
    return this._indexOf(e) > -1;
  }
  getCommonAncestor(e) {
    let t = this._indexOf(e) - 1;
    return t >= 0 ? this.items[t] : null;
  }
  isRootHtmlElementCurrent() {
    return this.stackTop === 0 && this.tagIDs[0] === r.HTML;
  }
  hasInDynamicScope(e, t) {
    for (let u = this.stackTop;u >= 0; u--) {
      let s = this.tagIDs[u];
      switch (this.treeAdapter.getNamespaceURI(this.items[u])) {
        case m.HTML: {
          if (s === e)
            return !0;
          if (t.has(s))
            return !1;
          break;
        }
        case m.SVG: {
          if (di.has(s))
            return !1;
          break;
        }
        case m.MATHML: {
          if (oi.has(s))
            return !1;
          break;
        }
      }
    }
    return !0;
  }
  hasInScope(e) {
    return this.hasInDynamicScope(e, ou);
  }
  hasInListItemScope(e) {
    return this.hasInDynamicScope(e, AA);
  }
  hasInButtonScope(e) {
    return this.hasInDynamicScope(e, oA);
  }
  hasNumberedHeaderInScope() {
    for (let e = this.stackTop;e >= 0; e--) {
      let t = this.tagIDs[e];
      switch (this.treeAdapter.getNamespaceURI(this.items[e])) {
        case m.HTML: {
          if (ft.has(t))
            return !0;
          if (ou.has(t))
            return !1;
          break;
        }
        case m.SVG: {
          if (di.has(t))
            return !1;
          break;
        }
        case m.MATHML: {
          if (oi.has(t))
            return !1;
          break;
        }
      }
    }
    return !0;
  }
  hasInTableScope(e) {
    for (let t = this.stackTop;t >= 0; t--) {
      if (this.treeAdapter.getNamespaceURI(this.items[t]) !== m.HTML)
        continue;
      switch (this.tagIDs[t]) {
        case e:
          return !0;
        case r.TABLE:
        case r.HTML:
          return !1;
      }
    }
    return !0;
  }
  hasTableBodyContextInTableScope() {
    for (let e = this.stackTop;e >= 0; e--) {
      if (this.treeAdapter.getNamespaceURI(this.items[e]) !== m.HTML)
        continue;
      switch (this.tagIDs[e]) {
        case r.TBODY:
        case r.THEAD:
        case r.TFOOT:
          return !0;
        case r.TABLE:
        case r.HTML:
          return !1;
      }
    }
    return !0;
  }
  hasInSelectScope(e) {
    for (let t = this.stackTop;t >= 0; t--) {
      if (this.treeAdapter.getNamespaceURI(this.items[t]) !== m.HTML)
        continue;
      switch (this.tagIDs[t]) {
        case e:
          return !0;
        case r.OPTION:
        case r.OPTGROUP:
          break;
        default:
          return !1;
      }
    }
    return !0;
  }
  generateImpliedEndTags() {
    while (this.currentTagId !== void 0 && li.has(this.currentTagId))
      this.pop();
  }
  generateImpliedEndTagsThoroughly() {
    while (this.currentTagId !== void 0 && Ai.has(this.currentTagId))
      this.pop();
  }
  generateImpliedEndTagsWithExclusion(e) {
    while (this.currentTagId !== void 0 && this.currentTagId !== e && Ai.has(this.currentTagId))
      this.pop();
  }
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/parser/formatting-element-list.js
var se;
(function(e) {
  e[e.Marker = 0] = "Marker", e[e.Element = 1] = "Element";
})(se || (se = {}));
var hi = { type: se.Marker };

class Ss {
  constructor(e) {
    this.treeAdapter = e, this.entries = [], this.bookmark = null;
  }
  _getNoahArkConditionCandidates(e, t) {
    let u = [], s = t.length, i = this.treeAdapter.getTagName(e), n = this.treeAdapter.getNamespaceURI(e);
    for (let a = 0;a < this.entries.length; a++) {
      let d = this.entries[a];
      if (d.type === se.Marker)
        break;
      let { element: l } = d;
      if (this.treeAdapter.getTagName(l) === i && this.treeAdapter.getNamespaceURI(l) === n) {
        let f = this.treeAdapter.getAttrList(l);
        if (f.length === s)
          u.push({ idx: a, attrs: f });
      }
    }
    return u;
  }
  _ensureNoahArkCondition(e) {
    if (this.entries.length < 3)
      return;
    let t = this.treeAdapter.getAttrList(e), u = this._getNoahArkConditionCandidates(e, t);
    if (u.length < 3)
      return;
    let s = new Map(t.map((n) => [n.name, n.value])), i = 0;
    for (let n = 0;n < u.length; n++) {
      let a = u[n];
      if (a.attrs.every((d) => s.get(d.name) === d.value)) {
        if (i += 1, i >= 3)
          this.entries.splice(a.idx, 1);
      }
    }
  }
  insertMarker() {
    this.entries.unshift(hi);
  }
  pushElement(e, t) {
    this._ensureNoahArkCondition(e), this.entries.unshift({
      type: se.Element,
      element: e,
      token: t
    });
  }
  insertElementAfterBookmark(e, t) {
    let u = this.entries.indexOf(this.bookmark);
    this.entries.splice(u, 0, {
      type: se.Element,
      element: e,
      token: t
    });
  }
  removeEntry(e) {
    let t = this.entries.indexOf(e);
    if (t !== -1)
      this.entries.splice(t, 1);
  }
  clearToLastMarker() {
    let e = this.entries.indexOf(hi);
    if (e === -1)
      this.entries.length = 0;
    else
      this.entries.splice(0, e + 1);
  }
  getElementEntryInScopeWithTagName(e) {
    let t = this.entries.find((u) => u.type === se.Marker || this.treeAdapter.getTagName(u.element) === e);
    return t && t.type === se.Element ? t : null;
  }
  getElementEntry(e) {
    return this.entries.find((t) => t.type === se.Element && t.element === e);
  }
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/tree-adapters/default.js
var z = {
  createDocument() {
    return {
      nodeName: "#document",
      mode: Y.NO_QUIRKS,
      childNodes: []
    };
  },
  createDocumentFragment() {
    return {
      nodeName: "#document-fragment",
      childNodes: []
    };
  },
  createElement(e, t, u) {
    return {
      nodeName: e,
      tagName: e,
      attrs: u,
      namespaceURI: t,
      childNodes: [],
      parentNode: null
    };
  },
  createCommentNode(e) {
    return {
      nodeName: "#comment",
      data: e,
      parentNode: null
    };
  },
  createTextNode(e) {
    return {
      nodeName: "#text",
      value: e,
      parentNode: null
    };
  },
  appendChild(e, t) {
    e.childNodes.push(t), t.parentNode = e;
  },
  insertBefore(e, t, u) {
    let s = e.childNodes.indexOf(u);
    e.childNodes.splice(s, 0, t), t.parentNode = e;
  },
  setTemplateContent(e, t) {
    e.content = t;
  },
  getTemplateContent(e) {
    return e.content;
  },
  setDocumentType(e, t, u, s) {
    let i = e.childNodes.find((n) => n.nodeName === "#documentType");
    if (i)
      i.name = t, i.publicId = u, i.systemId = s;
    else {
      let n = {
        nodeName: "#documentType",
        name: t,
        publicId: u,
        systemId: s,
        parentNode: null
      };
      z.appendChild(e, n);
    }
  },
  setDocumentMode(e, t) {
    e.mode = t;
  },
  getDocumentMode(e) {
    return e.mode;
  },
  detachNode(e) {
    if (e.parentNode) {
      let t = e.parentNode.childNodes.indexOf(e);
      e.parentNode.childNodes.splice(t, 1), e.parentNode = null;
    }
  },
  insertText(e, t) {
    if (e.childNodes.length > 0) {
      let u = e.childNodes[e.childNodes.length - 1];
      if (z.isTextNode(u)) {
        u.value += t;
        return;
      }
    }
    z.appendChild(e, z.createTextNode(t));
  },
  insertTextBefore(e, t, u) {
    let s = e.childNodes[e.childNodes.indexOf(u) - 1];
    if (s && z.isTextNode(s))
      s.value += t;
    else
      z.insertBefore(e, z.createTextNode(t), u);
  },
  adoptAttributes(e, t) {
    let u = new Set(e.attrs.map((s) => s.name));
    for (let s = 0;s < t.length; s++)
      if (!u.has(t[s].name))
        e.attrs.push(t[s]);
  },
  getFirstChild(e) {
    return e.childNodes[0];
  },
  getChildNodes(e) {
    return e.childNodes;
  },
  getParentNode(e) {
    return e.parentNode;
  },
  getAttrList(e) {
    return e.attrs;
  },
  getTagName(e) {
    return e.tagName;
  },
  getNamespaceURI(e) {
    return e.namespaceURI;
  },
  getTextNodeContent(e) {
    return e.value;
  },
  getCommentNodeContent(e) {
    return e.data;
  },
  getDocumentTypeNodeName(e) {
    return e.name;
  },
  getDocumentTypeNodePublicId(e) {
    return e.publicId;
  },
  getDocumentTypeNodeSystemId(e) {
    return e.systemId;
  },
  isTextNode(e) {
    return e.nodeName === "#text";
  },
  isCommentNode(e) {
    return e.nodeName === "#comment";
  },
  isDocumentTypeNode(e) {
    return e.nodeName === "#documentType";
  },
  isElementNode(e) {
    return Object.prototype.hasOwnProperty.call(e, "tagName");
  },
  setNodeSourceCodeLocation(e, t) {
    e.sourceCodeLocation = t;
  },
  getNodeSourceCodeLocation(e) {
    return e.sourceCodeLocation;
  },
  updateNodeSourceCodeLocation(e, t) {
    e.sourceCodeLocation = { ...e.sourceCodeLocation, ...t };
  }
};

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/common/doctype.js
var Ei = "html", EA = "about:legacy-compat", mA = "http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd", mi = [
  "+//silmaril//dtd html pro v0r11 19970101//",
  "-//as//dtd html 3.0 aswedit + extensions//",
  "-//advasoft ltd//dtd html 3.0 aswedit + extensions//",
  "-//ietf//dtd html 2.0 level 1//",
  "-//ietf//dtd html 2.0 level 2//",
  "-//ietf//dtd html 2.0 strict level 1//",
  "-//ietf//dtd html 2.0 strict level 2//",
  "-//ietf//dtd html 2.0 strict//",
  "-//ietf//dtd html 2.0//",
  "-//ietf//dtd html 2.1e//",
  "-//ietf//dtd html 3.0//",
  "-//ietf//dtd html 3.2 final//",
  "-//ietf//dtd html 3.2//",
  "-//ietf//dtd html 3//",
  "-//ietf//dtd html level 0//",
  "-//ietf//dtd html level 1//",
  "-//ietf//dtd html level 2//",
  "-//ietf//dtd html level 3//",
  "-//ietf//dtd html strict level 0//",
  "-//ietf//dtd html strict level 1//",
  "-//ietf//dtd html strict level 2//",
  "-//ietf//dtd html strict level 3//",
  "-//ietf//dtd html strict//",
  "-//ietf//dtd html//",
  "-//metrius//dtd metrius presentational//",
  "-//microsoft//dtd internet explorer 2.0 html strict//",
  "-//microsoft//dtd internet explorer 2.0 html//",
  "-//microsoft//dtd internet explorer 2.0 tables//",
  "-//microsoft//dtd internet explorer 3.0 html strict//",
  "-//microsoft//dtd internet explorer 3.0 html//",
  "-//microsoft//dtd internet explorer 3.0 tables//",
  "-//netscape comm. corp.//dtd html//",
  "-//netscape comm. corp.//dtd strict html//",
  "-//o'reilly and associates//dtd html 2.0//",
  "-//o'reilly and associates//dtd html extended 1.0//",
  "-//o'reilly and associates//dtd html extended relaxed 1.0//",
  "-//sq//dtd html 2.0 hotmetal + extensions//",
  "-//softquad software//dtd hotmetal pro 6.0::19990601::extensions to html 4.0//",
  "-//softquad//dtd hotmetal pro 4.0::19971010::extensions to html 4.0//",
  "-//spyglass//dtd html 2.0 extended//",
  "-//sun microsystems corp.//dtd hotjava html//",
  "-//sun microsystems corp.//dtd hotjava strict html//",
  "-//w3c//dtd html 3 1995-03-24//",
  "-//w3c//dtd html 3.2 draft//",
  "-//w3c//dtd html 3.2 final//",
  "-//w3c//dtd html 3.2//",
  "-//w3c//dtd html 3.2s draft//",
  "-//w3c//dtd html 4.0 frameset//",
  "-//w3c//dtd html 4.0 transitional//",
  "-//w3c//dtd html experimental 19960712//",
  "-//w3c//dtd html experimental 970421//",
  "-//w3c//dtd w3 html//",
  "-//w3o//dtd w3 html 3.0//",
  "-//webtechs//dtd mozilla html 2.0//",
  "-//webtechs//dtd mozilla html//"
], TA = [
  ...mi,
  "-//w3c//dtd html 4.01 frameset//",
  "-//w3c//dtd html 4.01 transitional//"
], gA = /* @__PURE__ */ new Set([
  "-//w3o//dtd w3 html strict 3.0//en//",
  "-/w3c/dtd html 4.0 transitional/en",
  "html"
]), Ti = ["-//w3c//dtd xhtml 1.0 frameset//", "-//w3c//dtd xhtml 1.0 transitional//"], bA = [
  ...Ti,
  "-//w3c//dtd html 4.01 frameset//",
  "-//w3c//dtd html 4.01 transitional//"
];
function fi(e, t) {
  return t.some((u) => e.startsWith(u));
}
function gi(e) {
  return e.name === Ei && e.publicId === null && (e.systemId === null || e.systemId === EA);
}
function bi(e) {
  if (e.name !== Ei)
    return Y.QUIRKS;
  let { systemId: t } = e;
  if (t && t.toLowerCase() === mA)
    return Y.QUIRKS;
  let { publicId: u } = e;
  if (u !== null) {
    if (u = u.toLowerCase(), gA.has(u))
      return Y.QUIRKS;
    let s = t === null ? TA : mi;
    if (fi(u, s))
      return Y.QUIRKS;
    if (s = t === null ? Ti : bA, fi(u, s))
      return Y.LIMITED_QUIRKS;
  }
  return Y.NO_QUIRKS;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/common/foreign-content.js
var pi = {
  TEXT_HTML: "text/html",
  APPLICATION_XML: "application/xhtml+xml"
}, IA = "definitionurl", CA = "definitionURL", _A = new Map([
  "attributeName",
  "attributeType",
  "baseFrequency",
  "baseProfile",
  "calcMode",
  "clipPathUnits",
  "diffuseConstant",
  "edgeMode",
  "filterUnits",
  "glyphRef",
  "gradientTransform",
  "gradientUnits",
  "kernelMatrix",
  "kernelUnitLength",
  "keyPoints",
  "keySplines",
  "keyTimes",
  "lengthAdjust",
  "limitingConeAngle",
  "markerHeight",
  "markerUnits",
  "markerWidth",
  "maskContentUnits",
  "maskUnits",
  "numOctaves",
  "pathLength",
  "patternContentUnits",
  "patternTransform",
  "patternUnits",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "preserveAlpha",
  "preserveAspectRatio",
  "primitiveUnits",
  "refX",
  "refY",
  "repeatCount",
  "repeatDur",
  "requiredExtensions",
  "requiredFeatures",
  "specularConstant",
  "specularExponent",
  "spreadMethod",
  "startOffset",
  "stdDeviation",
  "stitchTiles",
  "surfaceScale",
  "systemLanguage",
  "tableValues",
  "targetX",
  "targetY",
  "textLength",
  "viewBox",
  "viewTarget",
  "xChannelSelector",
  "yChannelSelector",
  "zoomAndPan"
].map((e) => [e.toLowerCase(), e])), NA = /* @__PURE__ */ new Map([
  ["xlink:actuate", { prefix: "xlink", name: "actuate", namespace: m.XLINK }],
  ["xlink:arcrole", { prefix: "xlink", name: "arcrole", namespace: m.XLINK }],
  ["xlink:href", { prefix: "xlink", name: "href", namespace: m.XLINK }],
  ["xlink:role", { prefix: "xlink", name: "role", namespace: m.XLINK }],
  ["xlink:show", { prefix: "xlink", name: "show", namespace: m.XLINK }],
  ["xlink:title", { prefix: "xlink", name: "title", namespace: m.XLINK }],
  ["xlink:type", { prefix: "xlink", name: "type", namespace: m.XLINK }],
  ["xml:lang", { prefix: "xml", name: "lang", namespace: m.XML }],
  ["xml:space", { prefix: "xml", name: "space", namespace: m.XML }],
  ["xmlns", { prefix: "", name: "xmlns", namespace: m.XMLNS }],
  ["xmlns:xlink", { prefix: "xmlns", name: "xlink", namespace: m.XMLNS }]
]), SA = new Map([
  "altGlyph",
  "altGlyphDef",
  "altGlyphItem",
  "animateColor",
  "animateMotion",
  "animateTransform",
  "clipPath",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "foreignObject",
  "glyphRef",
  "linearGradient",
  "radialGradient",
  "textPath"
].map((e) => [e.toLowerCase(), e])), DA = /* @__PURE__ */ new Set([
  r.B,
  r.BIG,
  r.BLOCKQUOTE,
  r.BODY,
  r.BR,
  r.CENTER,
  r.CODE,
  r.DD,
  r.DIV,
  r.DL,
  r.DT,
  r.EM,
  r.EMBED,
  r.H1,
  r.H2,
  r.H3,
  r.H4,
  r.H5,
  r.H6,
  r.HEAD,
  r.HR,
  r.I,
  r.IMG,
  r.LI,
  r.LISTING,
  r.MENU,
  r.META,
  r.NOBR,
  r.OL,
  r.P,
  r.PRE,
  r.RUBY,
  r.S,
  r.SMALL,
  r.SPAN,
  r.STRONG,
  r.STRIKE,
  r.SUB,
  r.SUP,
  r.TABLE,
  r.TT,
  r.U,
  r.UL,
  r.VAR
]);
function Ii(e) {
  let t = e.tagID;
  return t === r.FONT && e.attrs.some(({ name: s }) => s === fe.COLOR || s === fe.SIZE || s === fe.FACE) || DA.has(t);
}
function Ds(e) {
  for (let t = 0;t < e.attrs.length; t++)
    if (e.attrs[t].name === IA) {
      e.attrs[t].name = CA;
      break;
    }
}
function Bs(e) {
  for (let t = 0;t < e.attrs.length; t++) {
    let u = _A.get(e.attrs[t].name);
    if (u != null)
      e.attrs[t].name = u;
  }
}
function du(e) {
  for (let t = 0;t < e.attrs.length; t++) {
    let u = NA.get(e.attrs[t].name);
    if (u)
      e.attrs[t].prefix = u.prefix, e.attrs[t].name = u.name, e.attrs[t].namespace = u.namespace;
  }
}
function Ci(e) {
  let t = SA.get(e.tagName);
  if (t != null)
    e.tagName = t, e.tagID = we(e.tagName);
}
function BA(e, t) {
  return t === m.MATHML && (e === r.MI || e === r.MO || e === r.MN || e === r.MS || e === r.MTEXT);
}
function xA(e, t, u) {
  if (t === m.MATHML && e === r.ANNOTATION_XML) {
    for (let s = 0;s < u.length; s++)
      if (u[s].name === fe.ENCODING) {
        let i = u[s].value.toLowerCase();
        return i === pi.TEXT_HTML || i === pi.APPLICATION_XML;
      }
  }
  return t === m.SVG && (e === r.FOREIGN_OBJECT || e === r.DESC || e === r.TITLE);
}
function _i(e, t, u, s) {
  return (!s || s === m.HTML) && xA(e, t, u) || (!s || s === m.MATHML) && BA(e, t);
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/parser/index.js
var OA = "hidden", RA = 8, LA = 3, o;
(function(e) {
  e[e.INITIAL = 0] = "INITIAL", e[e.BEFORE_HTML = 1] = "BEFORE_HTML", e[e.BEFORE_HEAD = 2] = "BEFORE_HEAD", e[e.IN_HEAD = 3] = "IN_HEAD", e[e.IN_HEAD_NO_SCRIPT = 4] = "IN_HEAD_NO_SCRIPT", e[e.AFTER_HEAD = 5] = "AFTER_HEAD", e[e.IN_BODY = 6] = "IN_BODY", e[e.TEXT = 7] = "TEXT", e[e.IN_TABLE = 8] = "IN_TABLE", e[e.IN_TABLE_TEXT = 9] = "IN_TABLE_TEXT", e[e.IN_CAPTION = 10] = "IN_CAPTION", e[e.IN_COLUMN_GROUP = 11] = "IN_COLUMN_GROUP", e[e.IN_TABLE_BODY = 12] = "IN_TABLE_BODY", e[e.IN_ROW = 13] = "IN_ROW", e[e.IN_CELL = 14] = "IN_CELL", e[e.IN_SELECT = 15] = "IN_SELECT", e[e.IN_SELECT_IN_TABLE = 16] = "IN_SELECT_IN_TABLE", e[e.IN_TEMPLATE = 17] = "IN_TEMPLATE", e[e.AFTER_BODY = 18] = "AFTER_BODY", e[e.IN_FRAMESET = 19] = "IN_FRAMESET", e[e.AFTER_FRAMESET = 20] = "AFTER_FRAMESET", e[e.AFTER_AFTER_BODY = 21] = "AFTER_AFTER_BODY", e[e.AFTER_AFTER_FRAMESET = 22] = "AFTER_AFTER_FRAMESET";
})(o || (o = {}));
var yA = {
  startLine: -1,
  startCol: -1,
  startOffset: -1,
  endLine: -1,
  endCol: -1,
  endOffset: -1
}, xi = /* @__PURE__ */ new Set([r.TABLE, r.TBODY, r.TFOOT, r.THEAD, r.TR]), Si = {
  scriptingEnabled: !0,
  sourceCodeLocationInfo: !1,
  treeAdapter: z,
  onParseError: null
};

class Eu {
  constructor(e, t, u = null, s = null) {
    if (this.fragmentContext = u, this.scriptHandler = s, this.currentToken = null, this.stopped = !1, this.insertionMode = o.INITIAL, this.originalInsertionMode = o.INITIAL, this.headElement = null, this.formElement = null, this.currentNotInHTML = !1, this.tmplInsertionModeStack = [], this.pendingCharacterTokens = [], this.hasNonWhitespacePendingCharacterToken = !1, this.framesetOk = !0, this.skipNextNewLine = !1, this.fosterParentingEnabled = !1, this.options = {
      ...Si,
      ...e
    }, this.treeAdapter = this.options.treeAdapter, this.onParseError = this.options.onParseError, this.onParseError)
      this.options.sourceCodeLocationInfo = !0;
    this.document = t !== null && t !== void 0 ? t : this.treeAdapter.createDocument(), this.tokenizer = new Au(this.options, this), this.activeFormattingElements = new Ss(this.treeAdapter), this.fragmentContextID = u ? we(this.treeAdapter.getTagName(u)) : r.UNKNOWN, this._setContextModes(u !== null && u !== void 0 ? u : this.document, this.fragmentContextID), this.openElements = new Ns(this.document, this.treeAdapter, this);
  }
  static parse(e, t) {
    let u = new this(t);
    return u.tokenizer.write(e, !0), u.document;
  }
  static getFragmentParser(e, t) {
    let u = {
      ...Si,
      ...t
    };
    e !== null && e !== void 0 || (e = u.treeAdapter.createElement(h.TEMPLATE, m.HTML, []));
    let s = u.treeAdapter.createElement("documentmock", m.HTML, []), i = new this(u, s, e);
    if (i.fragmentContextID === r.TEMPLATE)
      i.tmplInsertionModeStack.unshift(o.IN_TEMPLATE);
    return i._initTokenizerForFragmentParsing(), i._insertFakeRootElement(), i._resetInsertionMode(), i._findFormInFragmentContext(), i;
  }
  getFragment() {
    let e = this.treeAdapter.getFirstChild(this.document), t = this.treeAdapter.createDocumentFragment();
    return this._adoptNodes(e, t), t;
  }
  _err(e, t, u) {
    var s;
    if (!this.onParseError)
      return;
    let i = (s = e.location) !== null && s !== void 0 ? s : yA, n = {
      code: t,
      startLine: i.startLine,
      startCol: i.startCol,
      startOffset: i.startOffset,
      endLine: u ? i.startLine : i.endLine,
      endCol: u ? i.startCol : i.endCol,
      endOffset: u ? i.startOffset : i.endOffset
    };
    this.onParseError(n);
  }
  onItemPush(e, t, u) {
    var s, i;
    if ((i = (s = this.treeAdapter).onItemPush) === null || i === void 0 || i.call(s, e), u && this.openElements.stackTop > 0)
      this._setContextModes(e, t);
  }
  onItemPop(e, t) {
    var u, s;
    if (this.options.sourceCodeLocationInfo)
      this._setEndLocation(e, this.currentToken);
    if ((s = (u = this.treeAdapter).onItemPop) === null || s === void 0 || s.call(u, e, this.openElements.current), t) {
      let i, n;
      if (this.openElements.stackTop === 0 && this.fragmentContext)
        i = this.fragmentContext, n = this.fragmentContextID;
      else
        ({ current: i, currentTagId: n } = this.openElements);
      this._setContextModes(i, n);
    }
  }
  _setContextModes(e, t) {
    let u = e === this.document || e && this.treeAdapter.getNamespaceURI(e) === m.HTML;
    this.currentNotInHTML = !u, this.tokenizer.inForeignNode = !u && e !== void 0 && t !== void 0 && !this._isIntegrationPoint(t, e);
  }
  _switchToTextParsing(e, t) {
    this._insertElement(e, m.HTML), this.tokenizer.state = t, this.originalInsertionMode = this.insertionMode, this.insertionMode = o.TEXT;
  }
  switchToPlaintextParsing() {
    this.insertionMode = o.TEXT, this.originalInsertionMode = o.IN_BODY, this.tokenizer.state = v.PLAINTEXT;
  }
  _getAdjustedCurrentElement() {
    return this.openElements.stackTop === 0 && this.fragmentContext ? this.fragmentContext : this.openElements.current;
  }
  _findFormInFragmentContext() {
    let e = this.fragmentContext;
    while (e) {
      if (this.treeAdapter.getTagName(e) === h.FORM) {
        this.formElement = e;
        break;
      }
      e = this.treeAdapter.getParentNode(e);
    }
  }
  _initTokenizerForFragmentParsing() {
    if (!this.fragmentContext || this.treeAdapter.getNamespaceURI(this.fragmentContext) !== m.HTML)
      return;
    switch (this.fragmentContextID) {
      case r.TITLE:
      case r.TEXTAREA: {
        this.tokenizer.state = v.RCDATA;
        break;
      }
      case r.STYLE:
      case r.XMP:
      case r.IFRAME:
      case r.NOEMBED:
      case r.NOFRAMES:
      case r.NOSCRIPT: {
        this.tokenizer.state = v.RAWTEXT;
        break;
      }
      case r.SCRIPT: {
        this.tokenizer.state = v.SCRIPT_DATA;
        break;
      }
      case r.PLAINTEXT: {
        this.tokenizer.state = v.PLAINTEXT;
        break;
      }
      default:
    }
  }
  _setDocumentType(e) {
    let t = e.name || "", u = e.publicId || "", s = e.systemId || "";
    if (this.treeAdapter.setDocumentType(this.document, t, u, s), e.location) {
      let n = this.treeAdapter.getChildNodes(this.document).find((a) => this.treeAdapter.isDocumentTypeNode(a));
      if (n)
        this.treeAdapter.setNodeSourceCodeLocation(n, e.location);
    }
  }
  _attachElementToTree(e, t) {
    if (this.options.sourceCodeLocationInfo) {
      let u = t && {
        ...t,
        startTag: t
      };
      this.treeAdapter.setNodeSourceCodeLocation(e, u);
    }
    if (this._shouldFosterParentOnInsertion())
      this._fosterParentElement(e);
    else {
      let u = this.openElements.currentTmplContentOrNode;
      this.treeAdapter.appendChild(u !== null && u !== void 0 ? u : this.document, e);
    }
  }
  _appendElement(e, t) {
    let u = this.treeAdapter.createElement(e.tagName, t, e.attrs);
    this._attachElementToTree(u, e.location);
  }
  _insertElement(e, t) {
    let u = this.treeAdapter.createElement(e.tagName, t, e.attrs);
    this._attachElementToTree(u, e.location), this.openElements.push(u, e.tagID);
  }
  _insertFakeElement(e, t) {
    let u = this.treeAdapter.createElement(e, m.HTML, []);
    this._attachElementToTree(u, null), this.openElements.push(u, t);
  }
  _insertTemplate(e) {
    let t = this.treeAdapter.createElement(e.tagName, m.HTML, e.attrs), u = this.treeAdapter.createDocumentFragment();
    if (this.treeAdapter.setTemplateContent(t, u), this._attachElementToTree(t, e.location), this.openElements.push(t, e.tagID), this.options.sourceCodeLocationInfo)
      this.treeAdapter.setNodeSourceCodeLocation(u, null);
  }
  _insertFakeRootElement() {
    let e = this.treeAdapter.createElement(h.HTML, m.HTML, []);
    if (this.options.sourceCodeLocationInfo)
      this.treeAdapter.setNodeSourceCodeLocation(e, null);
    this.treeAdapter.appendChild(this.openElements.current, e), this.openElements.push(e, r.HTML);
  }
  _appendCommentNode(e, t) {
    let u = this.treeAdapter.createCommentNode(e.data);
    if (this.treeAdapter.appendChild(t, u), this.options.sourceCodeLocationInfo)
      this.treeAdapter.setNodeSourceCodeLocation(u, e.location);
  }
  _insertCharacters(e) {
    let t, u;
    if (this._shouldFosterParentOnInsertion())
      if ({ parent: t, beforeElement: u } = this._findFosterParentingLocation(), u)
        this.treeAdapter.insertTextBefore(t, e.chars, u);
      else
        this.treeAdapter.insertText(t, e.chars);
    else
      t = this.openElements.currentTmplContentOrNode, this.treeAdapter.insertText(t, e.chars);
    if (!e.location)
      return;
    let s = this.treeAdapter.getChildNodes(t), i = u ? s.lastIndexOf(u) : s.length, n = s[i - 1];
    if (this.treeAdapter.getNodeSourceCodeLocation(n)) {
      let { endLine: d, endCol: l, endOffset: f } = e.location;
      this.treeAdapter.updateNodeSourceCodeLocation(n, { endLine: d, endCol: l, endOffset: f });
    } else if (this.options.sourceCodeLocationInfo)
      this.treeAdapter.setNodeSourceCodeLocation(n, e.location);
  }
  _adoptNodes(e, t) {
    for (let u = this.treeAdapter.getFirstChild(e);u; u = this.treeAdapter.getFirstChild(e))
      this.treeAdapter.detachNode(u), this.treeAdapter.appendChild(t, u);
  }
  _setEndLocation(e, t) {
    if (this.treeAdapter.getNodeSourceCodeLocation(e) && t.location) {
      let u = t.location, s = this.treeAdapter.getTagName(e), i = t.type === B.END_TAG && s === t.tagName ? {
        endTag: { ...u },
        endLine: u.endLine,
        endCol: u.endCol,
        endOffset: u.endOffset
      } : {
        endLine: u.startLine,
        endCol: u.startCol,
        endOffset: u.startOffset
      };
      this.treeAdapter.updateNodeSourceCodeLocation(e, i);
    }
  }
  shouldProcessStartTagTokenInForeignContent(e) {
    if (!this.currentNotInHTML)
      return !1;
    let t, u;
    if (this.openElements.stackTop === 0 && this.fragmentContext)
      t = this.fragmentContext, u = this.fragmentContextID;
    else
      ({ current: t, currentTagId: u } = this.openElements);
    if (e.tagID === r.SVG && this.treeAdapter.getTagName(t) === h.ANNOTATION_XML && this.treeAdapter.getNamespaceURI(t) === m.MATHML)
      return !1;
    return this.tokenizer.inForeignNode || (e.tagID === r.MGLYPH || e.tagID === r.MALIGNMARK) && u !== void 0 && !this._isIntegrationPoint(u, t, m.HTML);
  }
  _processToken(e) {
    switch (e.type) {
      case B.CHARACTER: {
        this.onCharacter(e);
        break;
      }
      case B.NULL_CHARACTER: {
        this.onNullCharacter(e);
        break;
      }
      case B.COMMENT: {
        this.onComment(e);
        break;
      }
      case B.DOCTYPE: {
        this.onDoctype(e);
        break;
      }
      case B.START_TAG: {
        this._processStartTag(e);
        break;
      }
      case B.END_TAG: {
        this.onEndTag(e);
        break;
      }
      case B.EOF: {
        this.onEof(e);
        break;
      }
      case B.WHITESPACE_CHARACTER: {
        this.onWhitespaceCharacter(e);
        break;
      }
    }
  }
  _isIntegrationPoint(e, t, u) {
    let s = this.treeAdapter.getNamespaceURI(t), i = this.treeAdapter.getAttrList(t);
    return _i(e, s, i, u);
  }
  _reconstructActiveFormattingElements() {
    let e = this.activeFormattingElements.entries.length;
    if (e) {
      let t = this.activeFormattingElements.entries.findIndex((s) => s.type === se.Marker || this.openElements.contains(s.element)), u = t === -1 ? e - 1 : t - 1;
      for (let s = u;s >= 0; s--) {
        let i = this.activeFormattingElements.entries[s];
        this._insertElement(i.token, this.treeAdapter.getNamespaceURI(i.element)), i.element = this.openElements.current;
      }
    }
  }
  _closeTableCell() {
    this.openElements.generateImpliedEndTags(), this.openElements.popUntilTableCellPopped(), this.activeFormattingElements.clearToLastMarker(), this.insertionMode = o.IN_ROW;
  }
  _closePElement() {
    this.openElements.generateImpliedEndTagsWithExclusion(r.P), this.openElements.popUntilTagNamePopped(r.P);
  }
  _resetInsertionMode() {
    for (let e = this.openElements.stackTop;e >= 0; e--)
      switch (e === 0 && this.fragmentContext ? this.fragmentContextID : this.openElements.tagIDs[e]) {
        case r.TR: {
          this.insertionMode = o.IN_ROW;
          return;
        }
        case r.TBODY:
        case r.THEAD:
        case r.TFOOT: {
          this.insertionMode = o.IN_TABLE_BODY;
          return;
        }
        case r.CAPTION: {
          this.insertionMode = o.IN_CAPTION;
          return;
        }
        case r.COLGROUP: {
          this.insertionMode = o.IN_COLUMN_GROUP;
          return;
        }
        case r.TABLE: {
          this.insertionMode = o.IN_TABLE;
          return;
        }
        case r.BODY: {
          this.insertionMode = o.IN_BODY;
          return;
        }
        case r.FRAMESET: {
          this.insertionMode = o.IN_FRAMESET;
          return;
        }
        case r.SELECT: {
          this._resetInsertionModeForSelect(e);
          return;
        }
        case r.TEMPLATE: {
          this.insertionMode = this.tmplInsertionModeStack[0];
          return;
        }
        case r.HTML: {
          this.insertionMode = this.headElement ? o.AFTER_HEAD : o.BEFORE_HEAD;
          return;
        }
        case r.TD:
        case r.TH: {
          if (e > 0) {
            this.insertionMode = o.IN_CELL;
            return;
          }
          break;
        }
        case r.HEAD: {
          if (e > 0) {
            this.insertionMode = o.IN_HEAD;
            return;
          }
          break;
        }
      }
    this.insertionMode = o.IN_BODY;
  }
  _resetInsertionModeForSelect(e) {
    if (e > 0)
      for (let t = e - 1;t > 0; t--) {
        let u = this.openElements.tagIDs[t];
        if (u === r.TEMPLATE)
          break;
        else if (u === r.TABLE) {
          this.insertionMode = o.IN_SELECT_IN_TABLE;
          return;
        }
      }
    this.insertionMode = o.IN_SELECT;
  }
  _isElementCausesFosterParenting(e) {
    return xi.has(e);
  }
  _shouldFosterParentOnInsertion() {
    return this.fosterParentingEnabled && this.openElements.currentTagId !== void 0 && this._isElementCausesFosterParenting(this.openElements.currentTagId);
  }
  _findFosterParentingLocation() {
    for (let e = this.openElements.stackTop;e >= 0; e--) {
      let t = this.openElements.items[e];
      switch (this.openElements.tagIDs[e]) {
        case r.TEMPLATE: {
          if (this.treeAdapter.getNamespaceURI(t) === m.HTML)
            return { parent: this.treeAdapter.getTemplateContent(t), beforeElement: null };
          break;
        }
        case r.TABLE: {
          let u = this.treeAdapter.getParentNode(t);
          if (u)
            return { parent: u, beforeElement: t };
          return { parent: this.openElements.items[e - 1], beforeElement: null };
        }
        default:
      }
    }
    return { parent: this.openElements.items[0], beforeElement: null };
  }
  _fosterParentElement(e) {
    let t = this._findFosterParentingLocation();
    if (t.beforeElement)
      this.treeAdapter.insertBefore(t.parent, e, t.beforeElement);
    else
      this.treeAdapter.appendChild(t.parent, e);
  }
  _isSpecialElement(e, t) {
    let u = this.treeAdapter.getNamespaceURI(e);
    return si[u].has(t);
  }
  onCharacter(e) {
    if (this.skipNextNewLine = !1, this.tokenizer.inForeignNode) {
      A0(this, e);
      return;
    }
    switch (this.insertionMode) {
      case o.INITIAL: {
        mt(this, e);
        break;
      }
      case o.BEFORE_HTML: {
        gt(this, e);
        break;
      }
      case o.BEFORE_HEAD: {
        bt(this, e);
        break;
      }
      case o.IN_HEAD: {
        pt(this, e);
        break;
      }
      case o.IN_HEAD_NO_SCRIPT: {
        It(this, e);
        break;
      }
      case o.AFTER_HEAD: {
        Ct(this, e);
        break;
      }
      case o.IN_BODY:
      case o.IN_CAPTION:
      case o.IN_CELL:
      case o.IN_TEMPLATE: {
        Ri(this, e);
        break;
      }
      case o.TEXT:
      case o.IN_SELECT:
      case o.IN_SELECT_IN_TABLE: {
        this._insertCharacters(e);
        break;
      }
      case o.IN_TABLE:
      case o.IN_TABLE_BODY:
      case o.IN_ROW: {
        xs(this, e);
        break;
      }
      case o.IN_TABLE_TEXT: {
        ki(this, e);
        break;
      }
      case o.IN_COLUMN_GROUP: {
        hu(this, e);
        break;
      }
      case o.AFTER_BODY: {
        fu(this, e);
        break;
      }
      case o.AFTER_AFTER_BODY: {
        lu(this, e);
        break;
      }
      default:
    }
  }
  onNullCharacter(e) {
    if (this.skipNextNewLine = !1, this.tokenizer.inForeignNode) {
      c0(this, e);
      return;
    }
    switch (this.insertionMode) {
      case o.INITIAL: {
        mt(this, e);
        break;
      }
      case o.BEFORE_HTML: {
        gt(this, e);
        break;
      }
      case o.BEFORE_HEAD: {
        bt(this, e);
        break;
      }
      case o.IN_HEAD: {
        pt(this, e);
        break;
      }
      case o.IN_HEAD_NO_SCRIPT: {
        It(this, e);
        break;
      }
      case o.AFTER_HEAD: {
        Ct(this, e);
        break;
      }
      case o.TEXT: {
        this._insertCharacters(e);
        break;
      }
      case o.IN_TABLE:
      case o.IN_TABLE_BODY:
      case o.IN_ROW: {
        xs(this, e);
        break;
      }
      case o.IN_COLUMN_GROUP: {
        hu(this, e);
        break;
      }
      case o.AFTER_BODY: {
        fu(this, e);
        break;
      }
      case o.AFTER_AFTER_BODY: {
        lu(this, e);
        break;
      }
      default:
    }
  }
  onComment(e) {
    if (this.skipNextNewLine = !1, this.currentNotInHTML) {
      Os(this, e);
      return;
    }
    switch (this.insertionMode) {
      case o.INITIAL:
      case o.BEFORE_HTML:
      case o.BEFORE_HEAD:
      case o.IN_HEAD:
      case o.IN_HEAD_NO_SCRIPT:
      case o.AFTER_HEAD:
      case o.IN_BODY:
      case o.IN_TABLE:
      case o.IN_CAPTION:
      case o.IN_COLUMN_GROUP:
      case o.IN_TABLE_BODY:
      case o.IN_ROW:
      case o.IN_CELL:
      case o.IN_SELECT:
      case o.IN_SELECT_IN_TABLE:
      case o.IN_TEMPLATE:
      case o.IN_FRAMESET:
      case o.AFTER_FRAMESET: {
        Os(this, e);
        break;
      }
      case o.IN_TABLE_TEXT: {
        Tt(this, e);
        break;
      }
      case o.AFTER_BODY: {
        UA(this, e);
        break;
      }
      case o.AFTER_AFTER_BODY:
      case o.AFTER_AFTER_FRAMESET: {
        QA(this, e);
        break;
      }
      default:
    }
  }
  onDoctype(e) {
    switch (this.skipNextNewLine = !1, this.insertionMode) {
      case o.INITIAL: {
        YA(this, e);
        break;
      }
      case o.BEFORE_HEAD:
      case o.IN_HEAD:
      case o.IN_HEAD_NO_SCRIPT:
      case o.AFTER_HEAD: {
        this._err(e, E.misplacedDoctype);
        break;
      }
      case o.IN_TABLE_TEXT: {
        Tt(this, e);
        break;
      }
      default:
    }
  }
  onStartTag(e) {
    if (this.skipNextNewLine = !1, this.currentToken = e, this._processStartTag(e), e.selfClosing && !e.ackSelfClosing)
      this._err(e, E.nonVoidHtmlElementStartTagWithTrailingSolidus);
  }
  _processStartTag(e) {
    if (this.shouldProcessStartTagTokenInForeignContent(e))
      o0(this, e);
    else
      this._startTagOutsideForeignContent(e);
  }
  _startTagOutsideForeignContent(e) {
    switch (this.insertionMode) {
      case o.INITIAL: {
        mt(this, e);
        break;
      }
      case o.BEFORE_HTML: {
        vA(this, e);
        break;
      }
      case o.BEFORE_HEAD: {
        KA(this, e);
        break;
      }
      case o.IN_HEAD: {
        re(this, e);
        break;
      }
      case o.IN_HEAD_NO_SCRIPT: {
        ZA(this, e);
        break;
      }
      case o.AFTER_HEAD: {
        VA(this, e);
        break;
      }
      case o.IN_BODY: {
        G(this, e);
        break;
      }
      case o.IN_TABLE: {
        ze(this, e);
        break;
      }
      case o.IN_TABLE_TEXT: {
        Tt(this, e);
        break;
      }
      case o.IN_CAPTION: {
        Jo(this, e);
        break;
      }
      case o.IN_COLUMN_GROUP: {
        Fs(this, e);
        break;
      }
      case o.IN_TABLE_BODY: {
        gu(this, e);
        break;
      }
      case o.IN_ROW: {
        bu(this, e);
        break;
      }
      case o.IN_CELL: {
        Vo(this, e);
        break;
      }
      case o.IN_SELECT: {
        Ui(this, e);
        break;
      }
      case o.IN_SELECT_IN_TABLE: {
        jo(this, e);
        break;
      }
      case o.IN_TEMPLATE: {
        $o(this, e);
        break;
      }
      case o.AFTER_BODY: {
        t0(this, e);
        break;
      }
      case o.IN_FRAMESET: {
        u0(this, e);
        break;
      }
      case o.AFTER_FRAMESET: {
        r0(this, e);
        break;
      }
      case o.AFTER_AFTER_BODY: {
        n0(this, e);
        break;
      }
      case o.AFTER_AFTER_FRAMESET: {
        a0(this, e);
        break;
      }
      default:
    }
  }
  onEndTag(e) {
    if (this.skipNextNewLine = !1, this.currentToken = e, this.currentNotInHTML)
      d0(this, e);
    else
      this._endTagOutsideForeignContent(e);
  }
  _endTagOutsideForeignContent(e) {
    switch (this.insertionMode) {
      case o.INITIAL: {
        mt(this, e);
        break;
      }
      case o.BEFORE_HTML: {
        GA(this, e);
        break;
      }
      case o.BEFORE_HEAD: {
        WA(this, e);
        break;
      }
      case o.IN_HEAD: {
        JA(this, e);
        break;
      }
      case o.IN_HEAD_NO_SCRIPT: {
        XA(this, e);
        break;
      }
      case o.AFTER_HEAD: {
        qA(this, e);
        break;
      }
      case o.IN_BODY: {
        Tu(this, e);
        break;
      }
      case o.TEXT: {
        ko(this, e);
        break;
      }
      case o.IN_TABLE: {
        _t(this, e);
        break;
      }
      case o.IN_TABLE_TEXT: {
        Tt(this, e);
        break;
      }
      case o.IN_CAPTION: {
        Zo(this, e);
        break;
      }
      case o.IN_COLUMN_GROUP: {
        Xo(this, e);
        break;
      }
      case o.IN_TABLE_BODY: {
        Rs(this, e);
        break;
      }
      case o.IN_ROW: {
        Hi(this, e);
        break;
      }
      case o.IN_CELL: {
        qo(this, e);
        break;
      }
      case o.IN_SELECT: {
        Qi(this, e);
        break;
      }
      case o.IN_SELECT_IN_TABLE: {
        zo(this, e);
        break;
      }
      case o.IN_TEMPLATE: {
        e0(this, e);
        break;
      }
      case o.AFTER_BODY: {
        vi(this, e);
        break;
      }
      case o.IN_FRAMESET: {
        s0(this, e);
        break;
      }
      case o.AFTER_FRAMESET: {
        i0(this, e);
        break;
      }
      case o.AFTER_AFTER_BODY: {
        lu(this, e);
        break;
      }
      default:
    }
  }
  onEof(e) {
    switch (this.insertionMode) {
      case o.INITIAL: {
        mt(this, e);
        break;
      }
      case o.BEFORE_HTML: {
        gt(this, e);
        break;
      }
      case o.BEFORE_HEAD: {
        bt(this, e);
        break;
      }
      case o.IN_HEAD: {
        pt(this, e);
        break;
      }
      case o.IN_HEAD_NO_SCRIPT: {
        It(this, e);
        break;
      }
      case o.AFTER_HEAD: {
        Ct(this, e);
        break;
      }
      case o.IN_BODY:
      case o.IN_TABLE:
      case o.IN_CAPTION:
      case o.IN_COLUMN_GROUP:
      case o.IN_TABLE_BODY:
      case o.IN_ROW:
      case o.IN_CELL:
      case o.IN_SELECT:
      case o.IN_SELECT_IN_TABLE: {
        Mi(this, e);
        break;
      }
      case o.TEXT: {
        Po(this, e);
        break;
      }
      case o.IN_TABLE_TEXT: {
        Tt(this, e);
        break;
      }
      case o.IN_TEMPLATE: {
        Yi(this, e);
        break;
      }
      case o.AFTER_BODY:
      case o.IN_FRAMESET:
      case o.AFTER_FRAMESET:
      case o.AFTER_AFTER_BODY:
      case o.AFTER_AFTER_FRAMESET: {
        ys(this, e);
        break;
      }
      default:
    }
  }
  onWhitespaceCharacter(e) {
    if (this.skipNextNewLine) {
      if (this.skipNextNewLine = !1, e.chars.charCodeAt(0) === c.LINE_FEED) {
        if (e.chars.length === 1)
          return;
        e.chars = e.chars.substr(1);
      }
    }
    if (this.tokenizer.inForeignNode) {
      this._insertCharacters(e);
      return;
    }
    switch (this.insertionMode) {
      case o.IN_HEAD:
      case o.IN_HEAD_NO_SCRIPT:
      case o.AFTER_HEAD:
      case o.TEXT:
      case o.IN_COLUMN_GROUP:
      case o.IN_SELECT:
      case o.IN_SELECT_IN_TABLE:
      case o.IN_FRAMESET:
      case o.AFTER_FRAMESET: {
        this._insertCharacters(e);
        break;
      }
      case o.IN_BODY:
      case o.IN_CAPTION:
      case o.IN_CELL:
      case o.IN_TEMPLATE:
      case o.AFTER_BODY:
      case o.AFTER_AFTER_BODY:
      case o.AFTER_AFTER_FRAMESET: {
        Oi(this, e);
        break;
      }
      case o.IN_TABLE:
      case o.IN_TABLE_BODY:
      case o.IN_ROW: {
        xs(this, e);
        break;
      }
      case o.IN_TABLE_TEXT: {
        wi(this, e);
        break;
      }
      default:
    }
  }
}
function FA(e, t) {
  let u = e.activeFormattingElements.getElementEntryInScopeWithTagName(t.tagName);
  if (u) {
    if (!e.openElements.contains(u.element))
      e.activeFormattingElements.removeEntry(u), u = null;
    else if (!e.openElements.hasInScope(t.tagID))
      u = null;
  } else
    Fi(e, t);
  return u;
}
function MA(e, t) {
  let u = null, s = e.openElements.stackTop;
  for (;s >= 0; s--) {
    let i = e.openElements.items[s];
    if (i === t.element)
      break;
    if (e._isSpecialElement(i, e.openElements.tagIDs[s]))
      u = i;
  }
  if (!u)
    e.openElements.shortenToLength(Math.max(s, 0)), e.activeFormattingElements.removeEntry(t);
  return u;
}
function wA(e, t, u) {
  let s = t, i = e.openElements.getCommonAncestor(t);
  for (let n = 0, a = i;a !== u; n++, a = i) {
    i = e.openElements.getCommonAncestor(a);
    let d = e.activeFormattingElements.getElementEntry(a), l = d && n >= LA;
    if (!d || l) {
      if (l)
        e.activeFormattingElements.removeEntry(d);
      e.openElements.remove(a);
    } else {
      if (a = kA(e, d), s === t)
        e.activeFormattingElements.bookmark = d;
      e.treeAdapter.detachNode(s), e.treeAdapter.appendChild(a, s), s = a;
    }
  }
  return s;
}
function kA(e, t) {
  let u = e.treeAdapter.getNamespaceURI(t.element), s = e.treeAdapter.createElement(t.token.tagName, u, t.token.attrs);
  return e.openElements.replace(t.element, s), t.element = s, s;
}
function PA(e, t, u) {
  let s = e.treeAdapter.getTagName(t), i = we(s);
  if (e._isElementCausesFosterParenting(i))
    e._fosterParentElement(u);
  else {
    let n = e.treeAdapter.getNamespaceURI(t);
    if (i === r.TEMPLATE && n === m.HTML)
      t = e.treeAdapter.getTemplateContent(t);
    e.treeAdapter.appendChild(t, u);
  }
}
function HA(e, t, u) {
  let s = e.treeAdapter.getNamespaceURI(u.element), { token: i } = u, n = e.treeAdapter.createElement(i.tagName, s, i.attrs);
  e._adoptNodes(t, n), e.treeAdapter.appendChild(t, n), e.activeFormattingElements.insertElementAfterBookmark(n, i), e.activeFormattingElements.removeEntry(u), e.openElements.remove(u.element), e.openElements.insertAfter(t, n, i.tagID);
}
function Ls(e, t) {
  for (let u = 0;u < RA; u++) {
    let s = FA(e, t);
    if (!s)
      break;
    let i = MA(e, s);
    if (!i)
      break;
    e.activeFormattingElements.bookmark = s;
    let n = wA(e, i, s.element), a = e.openElements.getCommonAncestor(s.element);
    if (e.treeAdapter.detachNode(n), a)
      PA(e, a, n);
    HA(e, i, s);
  }
}
function Os(e, t) {
  e._appendCommentNode(t, e.openElements.currentTmplContentOrNode);
}
function UA(e, t) {
  e._appendCommentNode(t, e.openElements.items[0]);
}
function QA(e, t) {
  e._appendCommentNode(t, e.document);
}
function ys(e, t) {
  if (e.stopped = !0, t.location) {
    let u = e.fragmentContext ? 0 : 2;
    for (let s = e.openElements.stackTop;s >= u; s--)
      e._setEndLocation(e.openElements.items[s], t);
    if (!e.fragmentContext && e.openElements.stackTop >= 0) {
      let s = e.openElements.items[0], i = e.treeAdapter.getNodeSourceCodeLocation(s);
      if (i && !i.endTag) {
        if (e._setEndLocation(s, t), e.openElements.stackTop >= 1) {
          let n = e.openElements.items[1], a = e.treeAdapter.getNodeSourceCodeLocation(n);
          if (a && !a.endTag)
            e._setEndLocation(n, t);
        }
      }
    }
  }
}
function YA(e, t) {
  e._setDocumentType(t);
  let u = t.forceQuirks ? Y.QUIRKS : bi(t);
  if (!gi(t))
    e._err(t, E.nonConformingDoctype);
  e.treeAdapter.setDocumentMode(e.document, u), e.insertionMode = o.BEFORE_HTML;
}
function mt(e, t) {
  e._err(t, E.missingDoctype, !0), e.treeAdapter.setDocumentMode(e.document, Y.QUIRKS), e.insertionMode = o.BEFORE_HTML, e._processToken(t);
}
function vA(e, t) {
  if (t.tagID === r.HTML)
    e._insertElement(t, m.HTML), e.insertionMode = o.BEFORE_HEAD;
  else
    gt(e, t);
}
function GA(e, t) {
  let u = t.tagID;
  if (u === r.HTML || u === r.HEAD || u === r.BODY || u === r.BR)
    gt(e, t);
}
function gt(e, t) {
  e._insertFakeRootElement(), e.insertionMode = o.BEFORE_HEAD, e._processToken(t);
}
function KA(e, t) {
  switch (t.tagID) {
    case r.HTML: {
      G(e, t);
      break;
    }
    case r.HEAD: {
      e._insertElement(t, m.HTML), e.headElement = e.openElements.current, e.insertionMode = o.IN_HEAD;
      break;
    }
    default:
      bt(e, t);
  }
}
function WA(e, t) {
  let u = t.tagID;
  if (u === r.HEAD || u === r.BODY || u === r.HTML || u === r.BR)
    bt(e, t);
  else
    e._err(t, E.endTagWithoutMatchingOpenElement);
}
function bt(e, t) {
  e._insertFakeElement(h.HEAD, r.HEAD), e.headElement = e.openElements.current, e.insertionMode = o.IN_HEAD, e._processToken(t);
}
function re(e, t) {
  switch (t.tagID) {
    case r.HTML: {
      G(e, t);
      break;
    }
    case r.BASE:
    case r.BASEFONT:
    case r.BGSOUND:
    case r.LINK:
    case r.META: {
      e._appendElement(t, m.HTML), t.ackSelfClosing = !0;
      break;
    }
    case r.TITLE: {
      e._switchToTextParsing(t, v.RCDATA);
      break;
    }
    case r.NOSCRIPT: {
      if (e.options.scriptingEnabled)
        e._switchToTextParsing(t, v.RAWTEXT);
      else
        e._insertElement(t, m.HTML), e.insertionMode = o.IN_HEAD_NO_SCRIPT;
      break;
    }
    case r.NOFRAMES:
    case r.STYLE: {
      e._switchToTextParsing(t, v.RAWTEXT);
      break;
    }
    case r.SCRIPT: {
      e._switchToTextParsing(t, v.SCRIPT_DATA);
      break;
    }
    case r.TEMPLATE: {
      e._insertTemplate(t), e.activeFormattingElements.insertMarker(), e.framesetOk = !1, e.insertionMode = o.IN_TEMPLATE, e.tmplInsertionModeStack.unshift(o.IN_TEMPLATE);
      break;
    }
    case r.HEAD: {
      e._err(t, E.misplacedStartTagForHeadElement);
      break;
    }
    default:
      pt(e, t);
  }
}
function JA(e, t) {
  switch (t.tagID) {
    case r.HEAD: {
      e.openElements.pop(), e.insertionMode = o.AFTER_HEAD;
      break;
    }
    case r.BODY:
    case r.BR:
    case r.HTML: {
      pt(e, t);
      break;
    }
    case r.TEMPLATE: {
      ke(e, t);
      break;
    }
    default:
      e._err(t, E.endTagWithoutMatchingOpenElement);
  }
}
function ke(e, t) {
  if (e.openElements.tmplCount > 0) {
    if (e.openElements.generateImpliedEndTagsThoroughly(), e.openElements.currentTagId !== r.TEMPLATE)
      e._err(t, E.closingOfElementWithOpenChildElements);
    e.openElements.popUntilTagNamePopped(r.TEMPLATE), e.activeFormattingElements.clearToLastMarker(), e.tmplInsertionModeStack.shift(), e._resetInsertionMode();
  } else
    e._err(t, E.endTagWithoutMatchingOpenElement);
}
function pt(e, t) {
  e.openElements.pop(), e.insertionMode = o.AFTER_HEAD, e._processToken(t);
}
function ZA(e, t) {
  switch (t.tagID) {
    case r.HTML: {
      G(e, t);
      break;
    }
    case r.BASEFONT:
    case r.BGSOUND:
    case r.HEAD:
    case r.LINK:
    case r.META:
    case r.NOFRAMES:
    case r.STYLE: {
      re(e, t);
      break;
    }
    case r.NOSCRIPT: {
      e._err(t, E.nestedNoscriptInHead);
      break;
    }
    default:
      It(e, t);
  }
}
function XA(e, t) {
  switch (t.tagID) {
    case r.NOSCRIPT: {
      e.openElements.pop(), e.insertionMode = o.IN_HEAD;
      break;
    }
    case r.BR: {
      It(e, t);
      break;
    }
    default:
      e._err(t, E.endTagWithoutMatchingOpenElement);
  }
}
function It(e, t) {
  let u = t.type === B.EOF ? E.openElementsLeftAfterEof : E.disallowedContentInNoscriptInHead;
  e._err(t, u), e.openElements.pop(), e.insertionMode = o.IN_HEAD, e._processToken(t);
}
function VA(e, t) {
  switch (t.tagID) {
    case r.HTML: {
      G(e, t);
      break;
    }
    case r.BODY: {
      e._insertElement(t, m.HTML), e.framesetOk = !1, e.insertionMode = o.IN_BODY;
      break;
    }
    case r.FRAMESET: {
      e._insertElement(t, m.HTML), e.insertionMode = o.IN_FRAMESET;
      break;
    }
    case r.BASE:
    case r.BASEFONT:
    case r.BGSOUND:
    case r.LINK:
    case r.META:
    case r.NOFRAMES:
    case r.SCRIPT:
    case r.STYLE:
    case r.TEMPLATE:
    case r.TITLE: {
      e._err(t, E.abandonedHeadElementChild), e.openElements.push(e.headElement, r.HEAD), re(e, t), e.openElements.remove(e.headElement);
      break;
    }
    case r.HEAD: {
      e._err(t, E.misplacedStartTagForHeadElement);
      break;
    }
    default:
      Ct(e, t);
  }
}
function qA(e, t) {
  switch (t.tagID) {
    case r.BODY:
    case r.HTML:
    case r.BR: {
      Ct(e, t);
      break;
    }
    case r.TEMPLATE: {
      ke(e, t);
      break;
    }
    default:
      e._err(t, E.endTagWithoutMatchingOpenElement);
  }
}
function Ct(e, t) {
  e._insertFakeElement(h.BODY, r.BODY), e.insertionMode = o.IN_BODY, mu(e, t);
}
function mu(e, t) {
  switch (t.type) {
    case B.CHARACTER: {
      Ri(e, t);
      break;
    }
    case B.WHITESPACE_CHARACTER: {
      Oi(e, t);
      break;
    }
    case B.COMMENT: {
      Os(e, t);
      break;
    }
    case B.START_TAG: {
      G(e, t);
      break;
    }
    case B.END_TAG: {
      Tu(e, t);
      break;
    }
    case B.EOF: {
      Mi(e, t);
      break;
    }
    default:
  }
}
function Oi(e, t) {
  e._reconstructActiveFormattingElements(), e._insertCharacters(t);
}
function Ri(e, t) {
  e._reconstructActiveFormattingElements(), e._insertCharacters(t), e.framesetOk = !1;
}
function jA(e, t) {
  if (e.openElements.tmplCount === 0)
    e.treeAdapter.adoptAttributes(e.openElements.items[0], t.attrs);
}
function zA(e, t) {
  let u = e.openElements.tryPeekProperlyNestedBodyElement();
  if (u && e.openElements.tmplCount === 0)
    e.framesetOk = !1, e.treeAdapter.adoptAttributes(u, t.attrs);
}
function $A(e, t) {
  let u = e.openElements.tryPeekProperlyNestedBodyElement();
  if (e.framesetOk && u)
    e.treeAdapter.detachNode(u), e.openElements.popAllUpToHtmlElement(), e._insertElement(t, m.HTML), e.insertionMode = o.IN_FRAMESET;
}
function eo(e, t) {
  if (e.openElements.hasInButtonScope(r.P))
    e._closePElement();
  e._insertElement(t, m.HTML);
}
function to(e, t) {
  if (e.openElements.hasInButtonScope(r.P))
    e._closePElement();
  if (e.openElements.currentTagId !== void 0 && ft.has(e.openElements.currentTagId))
    e.openElements.pop();
  e._insertElement(t, m.HTML);
}
function uo(e, t) {
  if (e.openElements.hasInButtonScope(r.P))
    e._closePElement();
  e._insertElement(t, m.HTML), e.skipNextNewLine = !0, e.framesetOk = !1;
}
function so(e, t) {
  let u = e.openElements.tmplCount > 0;
  if (!e.formElement || u) {
    if (e.openElements.hasInButtonScope(r.P))
      e._closePElement();
    if (e._insertElement(t, m.HTML), !u)
      e.formElement = e.openElements.current;
  }
}
function ro(e, t) {
  e.framesetOk = !1;
  let u = t.tagID;
  for (let s = e.openElements.stackTop;s >= 0; s--) {
    let i = e.openElements.tagIDs[s];
    if (u === r.LI && i === r.LI || (u === r.DD || u === r.DT) && (i === r.DD || i === r.DT)) {
      e.openElements.generateImpliedEndTagsWithExclusion(i), e.openElements.popUntilTagNamePopped(i);
      break;
    }
    if (i !== r.ADDRESS && i !== r.DIV && i !== r.P && e._isSpecialElement(e.openElements.items[s], i))
      break;
  }
  if (e.openElements.hasInButtonScope(r.P))
    e._closePElement();
  e._insertElement(t, m.HTML);
}
function io(e, t) {
  if (e.openElements.hasInButtonScope(r.P))
    e._closePElement();
  e._insertElement(t, m.HTML), e.tokenizer.state = v.PLAINTEXT;
}
function no(e, t) {
  if (e.openElements.hasInScope(r.BUTTON))
    e.openElements.generateImpliedEndTags(), e.openElements.popUntilTagNamePopped(r.BUTTON);
  e._reconstructActiveFormattingElements(), e._insertElement(t, m.HTML), e.framesetOk = !1;
}
function ao(e, t) {
  let u = e.activeFormattingElements.getElementEntryInScopeWithTagName(h.A);
  if (u)
    Ls(e, t), e.openElements.remove(u.element), e.activeFormattingElements.removeEntry(u);
  e._reconstructActiveFormattingElements(), e._insertElement(t, m.HTML), e.activeFormattingElements.pushElement(e.openElements.current, t);
}
function co(e, t) {
  e._reconstructActiveFormattingElements(), e._insertElement(t, m.HTML), e.activeFormattingElements.pushElement(e.openElements.current, t);
}
function Ao(e, t) {
  if (e._reconstructActiveFormattingElements(), e.openElements.hasInScope(r.NOBR))
    Ls(e, t), e._reconstructActiveFormattingElements();
  e._insertElement(t, m.HTML), e.activeFormattingElements.pushElement(e.openElements.current, t);
}
function oo(e, t) {
  e._reconstructActiveFormattingElements(), e._insertElement(t, m.HTML), e.activeFormattingElements.insertMarker(), e.framesetOk = !1;
}
function lo(e, t) {
  if (e.treeAdapter.getDocumentMode(e.document) !== Y.QUIRKS && e.openElements.hasInButtonScope(r.P))
    e._closePElement();
  e._insertElement(t, m.HTML), e.framesetOk = !1, e.insertionMode = o.IN_TABLE;
}
function Li(e, t) {
  e._reconstructActiveFormattingElements(), e._appendElement(t, m.HTML), e.framesetOk = !1, t.ackSelfClosing = !0;
}
function yi(e) {
  let t = au(e, fe.TYPE);
  return t != null && t.toLowerCase() === OA;
}
function ho(e, t) {
  if (e._reconstructActiveFormattingElements(), e._appendElement(t, m.HTML), !yi(t))
    e.framesetOk = !1;
  t.ackSelfClosing = !0;
}
function fo(e, t) {
  e._appendElement(t, m.HTML), t.ackSelfClosing = !0;
}
function Eo(e, t) {
  if (e.openElements.hasInButtonScope(r.P))
    e._closePElement();
  e._appendElement(t, m.HTML), e.framesetOk = !1, t.ackSelfClosing = !0;
}
function mo(e, t) {
  t.tagName = h.IMG, t.tagID = r.IMG, Li(e, t);
}
function To(e, t) {
  e._insertElement(t, m.HTML), e.skipNextNewLine = !0, e.tokenizer.state = v.RCDATA, e.originalInsertionMode = e.insertionMode, e.framesetOk = !1, e.insertionMode = o.TEXT;
}
function go(e, t) {
  if (e.openElements.hasInButtonScope(r.P))
    e._closePElement();
  e._reconstructActiveFormattingElements(), e.framesetOk = !1, e._switchToTextParsing(t, v.RAWTEXT);
}
function bo(e, t) {
  e.framesetOk = !1, e._switchToTextParsing(t, v.RAWTEXT);
}
function Di(e, t) {
  e._switchToTextParsing(t, v.RAWTEXT);
}
function po(e, t) {
  e._reconstructActiveFormattingElements(), e._insertElement(t, m.HTML), e.framesetOk = !1, e.insertionMode = e.insertionMode === o.IN_TABLE || e.insertionMode === o.IN_CAPTION || e.insertionMode === o.IN_TABLE_BODY || e.insertionMode === o.IN_ROW || e.insertionMode === o.IN_CELL ? o.IN_SELECT_IN_TABLE : o.IN_SELECT;
}
function Io(e, t) {
  if (e.openElements.currentTagId === r.OPTION)
    e.openElements.pop();
  e._reconstructActiveFormattingElements(), e._insertElement(t, m.HTML);
}
function Co(e, t) {
  if (e.openElements.hasInScope(r.RUBY))
    e.openElements.generateImpliedEndTags();
  e._insertElement(t, m.HTML);
}
function _o(e, t) {
  if (e.openElements.hasInScope(r.RUBY))
    e.openElements.generateImpliedEndTagsWithExclusion(r.RTC);
  e._insertElement(t, m.HTML);
}
function No(e, t) {
  if (e._reconstructActiveFormattingElements(), Ds(t), du(t), t.selfClosing)
    e._appendElement(t, m.MATHML);
  else
    e._insertElement(t, m.MATHML);
  t.ackSelfClosing = !0;
}
function So(e, t) {
  if (e._reconstructActiveFormattingElements(), Bs(t), du(t), t.selfClosing)
    e._appendElement(t, m.SVG);
  else
    e._insertElement(t, m.SVG);
  t.ackSelfClosing = !0;
}
function Bi(e, t) {
  e._reconstructActiveFormattingElements(), e._insertElement(t, m.HTML);
}
function G(e, t) {
  switch (t.tagID) {
    case r.I:
    case r.S:
    case r.B:
    case r.U:
    case r.EM:
    case r.TT:
    case r.BIG:
    case r.CODE:
    case r.FONT:
    case r.SMALL:
    case r.STRIKE:
    case r.STRONG: {
      co(e, t);
      break;
    }
    case r.A: {
      ao(e, t);
      break;
    }
    case r.H1:
    case r.H2:
    case r.H3:
    case r.H4:
    case r.H5:
    case r.H6: {
      to(e, t);
      break;
    }
    case r.P:
    case r.DL:
    case r.OL:
    case r.UL:
    case r.DIV:
    case r.DIR:
    case r.NAV:
    case r.MAIN:
    case r.MENU:
    case r.ASIDE:
    case r.CENTER:
    case r.FIGURE:
    case r.FOOTER:
    case r.HEADER:
    case r.HGROUP:
    case r.DIALOG:
    case r.DETAILS:
    case r.ADDRESS:
    case r.ARTICLE:
    case r.SEARCH:
    case r.SECTION:
    case r.SUMMARY:
    case r.FIELDSET:
    case r.BLOCKQUOTE:
    case r.FIGCAPTION: {
      eo(e, t);
      break;
    }
    case r.LI:
    case r.DD:
    case r.DT: {
      ro(e, t);
      break;
    }
    case r.BR:
    case r.IMG:
    case r.WBR:
    case r.AREA:
    case r.EMBED:
    case r.KEYGEN: {
      Li(e, t);
      break;
    }
    case r.HR: {
      Eo(e, t);
      break;
    }
    case r.RB:
    case r.RTC: {
      Co(e, t);
      break;
    }
    case r.RT:
    case r.RP: {
      _o(e, t);
      break;
    }
    case r.PRE:
    case r.LISTING: {
      uo(e, t);
      break;
    }
    case r.XMP: {
      go(e, t);
      break;
    }
    case r.SVG: {
      So(e, t);
      break;
    }
    case r.HTML: {
      jA(e, t);
      break;
    }
    case r.BASE:
    case r.LINK:
    case r.META:
    case r.STYLE:
    case r.TITLE:
    case r.SCRIPT:
    case r.BGSOUND:
    case r.BASEFONT:
    case r.TEMPLATE: {
      re(e, t);
      break;
    }
    case r.BODY: {
      zA(e, t);
      break;
    }
    case r.FORM: {
      so(e, t);
      break;
    }
    case r.NOBR: {
      Ao(e, t);
      break;
    }
    case r.MATH: {
      No(e, t);
      break;
    }
    case r.TABLE: {
      lo(e, t);
      break;
    }
    case r.INPUT: {
      ho(e, t);
      break;
    }
    case r.PARAM:
    case r.TRACK:
    case r.SOURCE: {
      fo(e, t);
      break;
    }
    case r.IMAGE: {
      mo(e, t);
      break;
    }
    case r.BUTTON: {
      no(e, t);
      break;
    }
    case r.APPLET:
    case r.OBJECT:
    case r.MARQUEE: {
      oo(e, t);
      break;
    }
    case r.IFRAME: {
      bo(e, t);
      break;
    }
    case r.SELECT: {
      po(e, t);
      break;
    }
    case r.OPTION:
    case r.OPTGROUP: {
      Io(e, t);
      break;
    }
    case r.NOEMBED:
    case r.NOFRAMES: {
      Di(e, t);
      break;
    }
    case r.FRAMESET: {
      $A(e, t);
      break;
    }
    case r.TEXTAREA: {
      To(e, t);
      break;
    }
    case r.NOSCRIPT: {
      if (e.options.scriptingEnabled)
        Di(e, t);
      else
        Bi(e, t);
      break;
    }
    case r.PLAINTEXT: {
      io(e, t);
      break;
    }
    case r.COL:
    case r.TH:
    case r.TD:
    case r.TR:
    case r.HEAD:
    case r.FRAME:
    case r.TBODY:
    case r.TFOOT:
    case r.THEAD:
    case r.CAPTION:
    case r.COLGROUP:
      break;
    default:
      Bi(e, t);
  }
}
function Do(e, t) {
  if (e.openElements.hasInScope(r.BODY)) {
    if (e.insertionMode = o.AFTER_BODY, e.options.sourceCodeLocationInfo) {
      let u = e.openElements.tryPeekProperlyNestedBodyElement();
      if (u)
        e._setEndLocation(u, t);
    }
  }
}
function Bo(e, t) {
  if (e.openElements.hasInScope(r.BODY))
    e.insertionMode = o.AFTER_BODY, vi(e, t);
}
function xo(e, t) {
  let u = t.tagID;
  if (e.openElements.hasInScope(u))
    e.openElements.generateImpliedEndTags(), e.openElements.popUntilTagNamePopped(u);
}
function Oo(e) {
  let t = e.openElements.tmplCount > 0, { formElement: u } = e;
  if (!t)
    e.formElement = null;
  if ((u || t) && e.openElements.hasInScope(r.FORM)) {
    if (e.openElements.generateImpliedEndTags(), t)
      e.openElements.popUntilTagNamePopped(r.FORM);
    else if (u)
      e.openElements.remove(u);
  }
}
function Ro(e) {
  if (!e.openElements.hasInButtonScope(r.P))
    e._insertFakeElement(h.P, r.P);
  e._closePElement();
}
function Lo(e) {
  if (e.openElements.hasInListItemScope(r.LI))
    e.openElements.generateImpliedEndTagsWithExclusion(r.LI), e.openElements.popUntilTagNamePopped(r.LI);
}
function yo(e, t) {
  let u = t.tagID;
  if (e.openElements.hasInScope(u))
    e.openElements.generateImpliedEndTagsWithExclusion(u), e.openElements.popUntilTagNamePopped(u);
}
function Fo(e) {
  if (e.openElements.hasNumberedHeaderInScope())
    e.openElements.generateImpliedEndTags(), e.openElements.popUntilNumberedHeaderPopped();
}
function Mo(e, t) {
  let u = t.tagID;
  if (e.openElements.hasInScope(u))
    e.openElements.generateImpliedEndTags(), e.openElements.popUntilTagNamePopped(u), e.activeFormattingElements.clearToLastMarker();
}
function wo(e) {
  e._reconstructActiveFormattingElements(), e._insertFakeElement(h.BR, r.BR), e.openElements.pop(), e.framesetOk = !1;
}
function Fi(e, t) {
  let { tagName: u, tagID: s } = t;
  for (let i = e.openElements.stackTop;i > 0; i--) {
    let n = e.openElements.items[i], a = e.openElements.tagIDs[i];
    if (s === a && (s !== r.UNKNOWN || e.treeAdapter.getTagName(n) === u)) {
      if (e.openElements.generateImpliedEndTagsWithExclusion(s), e.openElements.stackTop >= i)
        e.openElements.shortenToLength(i);
      break;
    }
    if (e._isSpecialElement(n, a))
      break;
  }
}
function Tu(e, t) {
  switch (t.tagID) {
    case r.A:
    case r.B:
    case r.I:
    case r.S:
    case r.U:
    case r.EM:
    case r.TT:
    case r.BIG:
    case r.CODE:
    case r.FONT:
    case r.NOBR:
    case r.SMALL:
    case r.STRIKE:
    case r.STRONG: {
      Ls(e, t);
      break;
    }
    case r.P: {
      Ro(e);
      break;
    }
    case r.DL:
    case r.UL:
    case r.OL:
    case r.DIR:
    case r.DIV:
    case r.NAV:
    case r.PRE:
    case r.MAIN:
    case r.MENU:
    case r.ASIDE:
    case r.BUTTON:
    case r.CENTER:
    case r.FIGURE:
    case r.FOOTER:
    case r.HEADER:
    case r.HGROUP:
    case r.DIALOG:
    case r.ADDRESS:
    case r.ARTICLE:
    case r.DETAILS:
    case r.SEARCH:
    case r.SECTION:
    case r.SUMMARY:
    case r.LISTING:
    case r.FIELDSET:
    case r.BLOCKQUOTE:
    case r.FIGCAPTION: {
      xo(e, t);
      break;
    }
    case r.LI: {
      Lo(e);
      break;
    }
    case r.DD:
    case r.DT: {
      yo(e, t);
      break;
    }
    case r.H1:
    case r.H2:
    case r.H3:
    case r.H4:
    case r.H5:
    case r.H6: {
      Fo(e);
      break;
    }
    case r.BR: {
      wo(e);
      break;
    }
    case r.BODY: {
      Do(e, t);
      break;
    }
    case r.HTML: {
      Bo(e, t);
      break;
    }
    case r.FORM: {
      Oo(e);
      break;
    }
    case r.APPLET:
    case r.OBJECT:
    case r.MARQUEE: {
      Mo(e, t);
      break;
    }
    case r.TEMPLATE: {
      ke(e, t);
      break;
    }
    default:
      Fi(e, t);
  }
}
function Mi(e, t) {
  if (e.tmplInsertionModeStack.length > 0)
    Yi(e, t);
  else
    ys(e, t);
}
function ko(e, t) {
  var u;
  if (t.tagID === r.SCRIPT)
    (u = e.scriptHandler) === null || u === void 0 || u.call(e, e.openElements.current);
  e.openElements.pop(), e.insertionMode = e.originalInsertionMode;
}
function Po(e, t) {
  e._err(t, E.eofInElementThatCanContainOnlyText), e.openElements.pop(), e.insertionMode = e.originalInsertionMode, e.onEof(t);
}
function xs(e, t) {
  if (e.openElements.currentTagId !== void 0 && xi.has(e.openElements.currentTagId))
    switch (e.pendingCharacterTokens.length = 0, e.hasNonWhitespacePendingCharacterToken = !1, e.originalInsertionMode = e.insertionMode, e.insertionMode = o.IN_TABLE_TEXT, t.type) {
      case B.CHARACTER: {
        ki(e, t);
        break;
      }
      case B.WHITESPACE_CHARACTER: {
        wi(e, t);
        break;
      }
    }
  else
    Nt(e, t);
}
function Ho(e, t) {
  e.openElements.clearBackToTableContext(), e.activeFormattingElements.insertMarker(), e._insertElement(t, m.HTML), e.insertionMode = o.IN_CAPTION;
}
function Uo(e, t) {
  e.openElements.clearBackToTableContext(), e._insertElement(t, m.HTML), e.insertionMode = o.IN_COLUMN_GROUP;
}
function Qo(e, t) {
  e.openElements.clearBackToTableContext(), e._insertFakeElement(h.COLGROUP, r.COLGROUP), e.insertionMode = o.IN_COLUMN_GROUP, Fs(e, t);
}
function Yo(e, t) {
  e.openElements.clearBackToTableContext(), e._insertElement(t, m.HTML), e.insertionMode = o.IN_TABLE_BODY;
}
function vo(e, t) {
  e.openElements.clearBackToTableContext(), e._insertFakeElement(h.TBODY, r.TBODY), e.insertionMode = o.IN_TABLE_BODY, gu(e, t);
}
function Go(e, t) {
  if (e.openElements.hasInTableScope(r.TABLE))
    e.openElements.popUntilTagNamePopped(r.TABLE), e._resetInsertionMode(), e._processStartTag(t);
}
function Ko(e, t) {
  if (yi(t))
    e._appendElement(t, m.HTML);
  else
    Nt(e, t);
  t.ackSelfClosing = !0;
}
function Wo(e, t) {
  if (!e.formElement && e.openElements.tmplCount === 0)
    e._insertElement(t, m.HTML), e.formElement = e.openElements.current, e.openElements.pop();
}
function ze(e, t) {
  switch (t.tagID) {
    case r.TD:
    case r.TH:
    case r.TR: {
      vo(e, t);
      break;
    }
    case r.STYLE:
    case r.SCRIPT:
    case r.TEMPLATE: {
      re(e, t);
      break;
    }
    case r.COL: {
      Qo(e, t);
      break;
    }
    case r.FORM: {
      Wo(e, t);
      break;
    }
    case r.TABLE: {
      Go(e, t);
      break;
    }
    case r.TBODY:
    case r.TFOOT:
    case r.THEAD: {
      Yo(e, t);
      break;
    }
    case r.INPUT: {
      Ko(e, t);
      break;
    }
    case r.CAPTION: {
      Ho(e, t);
      break;
    }
    case r.COLGROUP: {
      Uo(e, t);
      break;
    }
    default:
      Nt(e, t);
  }
}
function _t(e, t) {
  switch (t.tagID) {
    case r.TABLE: {
      if (e.openElements.hasInTableScope(r.TABLE))
        e.openElements.popUntilTagNamePopped(r.TABLE), e._resetInsertionMode();
      break;
    }
    case r.TEMPLATE: {
      ke(e, t);
      break;
    }
    case r.BODY:
    case r.CAPTION:
    case r.COL:
    case r.COLGROUP:
    case r.HTML:
    case r.TBODY:
    case r.TD:
    case r.TFOOT:
    case r.TH:
    case r.THEAD:
    case r.TR:
      break;
    default:
      Nt(e, t);
  }
}
function Nt(e, t) {
  let u = e.fosterParentingEnabled;
  e.fosterParentingEnabled = !0, mu(e, t), e.fosterParentingEnabled = u;
}
function wi(e, t) {
  e.pendingCharacterTokens.push(t);
}
function ki(e, t) {
  e.pendingCharacterTokens.push(t), e.hasNonWhitespacePendingCharacterToken = !0;
}
function Tt(e, t) {
  let u = 0;
  if (e.hasNonWhitespacePendingCharacterToken)
    for (;u < e.pendingCharacterTokens.length; u++)
      Nt(e, e.pendingCharacterTokens[u]);
  else
    for (;u < e.pendingCharacterTokens.length; u++)
      e._insertCharacters(e.pendingCharacterTokens[u]);
  e.insertionMode = e.originalInsertionMode, e._processToken(t);
}
var Pi = /* @__PURE__ */ new Set([r.CAPTION, r.COL, r.COLGROUP, r.TBODY, r.TD, r.TFOOT, r.TH, r.THEAD, r.TR]);
function Jo(e, t) {
  let u = t.tagID;
  if (Pi.has(u)) {
    if (e.openElements.hasInTableScope(r.CAPTION))
      e.openElements.generateImpliedEndTags(), e.openElements.popUntilTagNamePopped(r.CAPTION), e.activeFormattingElements.clearToLastMarker(), e.insertionMode = o.IN_TABLE, ze(e, t);
  } else
    G(e, t);
}
function Zo(e, t) {
  let u = t.tagID;
  switch (u) {
    case r.CAPTION:
    case r.TABLE: {
      if (e.openElements.hasInTableScope(r.CAPTION)) {
        if (e.openElements.generateImpliedEndTags(), e.openElements.popUntilTagNamePopped(r.CAPTION), e.activeFormattingElements.clearToLastMarker(), e.insertionMode = o.IN_TABLE, u === r.TABLE)
          _t(e, t);
      }
      break;
    }
    case r.BODY:
    case r.COL:
    case r.COLGROUP:
    case r.HTML:
    case r.TBODY:
    case r.TD:
    case r.TFOOT:
    case r.TH:
    case r.THEAD:
    case r.TR:
      break;
    default:
      Tu(e, t);
  }
}
function Fs(e, t) {
  switch (t.tagID) {
    case r.HTML: {
      G(e, t);
      break;
    }
    case r.COL: {
      e._appendElement(t, m.HTML), t.ackSelfClosing = !0;
      break;
    }
    case r.TEMPLATE: {
      re(e, t);
      break;
    }
    default:
      hu(e, t);
  }
}
function Xo(e, t) {
  switch (t.tagID) {
    case r.COLGROUP: {
      if (e.openElements.currentTagId === r.COLGROUP)
        e.openElements.pop(), e.insertionMode = o.IN_TABLE;
      break;
    }
    case r.TEMPLATE: {
      ke(e, t);
      break;
    }
    case r.COL:
      break;
    default:
      hu(e, t);
  }
}
function hu(e, t) {
  if (e.openElements.currentTagId === r.COLGROUP)
    e.openElements.pop(), e.insertionMode = o.IN_TABLE, e._processToken(t);
}
function gu(e, t) {
  switch (t.tagID) {
    case r.TR: {
      e.openElements.clearBackToTableBodyContext(), e._insertElement(t, m.HTML), e.insertionMode = o.IN_ROW;
      break;
    }
    case r.TH:
    case r.TD: {
      e.openElements.clearBackToTableBodyContext(), e._insertFakeElement(h.TR, r.TR), e.insertionMode = o.IN_ROW, bu(e, t);
      break;
    }
    case r.CAPTION:
    case r.COL:
    case r.COLGROUP:
    case r.TBODY:
    case r.TFOOT:
    case r.THEAD: {
      if (e.openElements.hasTableBodyContextInTableScope())
        e.openElements.clearBackToTableBodyContext(), e.openElements.pop(), e.insertionMode = o.IN_TABLE, ze(e, t);
      break;
    }
    default:
      ze(e, t);
  }
}
function Rs(e, t) {
  let u = t.tagID;
  switch (t.tagID) {
    case r.TBODY:
    case r.TFOOT:
    case r.THEAD: {
      if (e.openElements.hasInTableScope(u))
        e.openElements.clearBackToTableBodyContext(), e.openElements.pop(), e.insertionMode = o.IN_TABLE;
      break;
    }
    case r.TABLE: {
      if (e.openElements.hasTableBodyContextInTableScope())
        e.openElements.clearBackToTableBodyContext(), e.openElements.pop(), e.insertionMode = o.IN_TABLE, _t(e, t);
      break;
    }
    case r.BODY:
    case r.CAPTION:
    case r.COL:
    case r.COLGROUP:
    case r.HTML:
    case r.TD:
    case r.TH:
    case r.TR:
      break;
    default:
      _t(e, t);
  }
}
function bu(e, t) {
  switch (t.tagID) {
    case r.TH:
    case r.TD: {
      e.openElements.clearBackToTableRowContext(), e._insertElement(t, m.HTML), e.insertionMode = o.IN_CELL, e.activeFormattingElements.insertMarker();
      break;
    }
    case r.CAPTION:
    case r.COL:
    case r.COLGROUP:
    case r.TBODY:
    case r.TFOOT:
    case r.THEAD:
    case r.TR: {
      if (e.openElements.hasInTableScope(r.TR))
        e.openElements.clearBackToTableRowContext(), e.openElements.pop(), e.insertionMode = o.IN_TABLE_BODY, gu(e, t);
      break;
    }
    default:
      ze(e, t);
  }
}
function Hi(e, t) {
  switch (t.tagID) {
    case r.TR: {
      if (e.openElements.hasInTableScope(r.TR))
        e.openElements.clearBackToTableRowContext(), e.openElements.pop(), e.insertionMode = o.IN_TABLE_BODY;
      break;
    }
    case r.TABLE: {
      if (e.openElements.hasInTableScope(r.TR))
        e.openElements.clearBackToTableRowContext(), e.openElements.pop(), e.insertionMode = o.IN_TABLE_BODY, Rs(e, t);
      break;
    }
    case r.TBODY:
    case r.TFOOT:
    case r.THEAD: {
      if (e.openElements.hasInTableScope(t.tagID) || e.openElements.hasInTableScope(r.TR))
        e.openElements.clearBackToTableRowContext(), e.openElements.pop(), e.insertionMode = o.IN_TABLE_BODY, Rs(e, t);
      break;
    }
    case r.BODY:
    case r.CAPTION:
    case r.COL:
    case r.COLGROUP:
    case r.HTML:
    case r.TD:
    case r.TH:
      break;
    default:
      _t(e, t);
  }
}
function Vo(e, t) {
  let u = t.tagID;
  if (Pi.has(u)) {
    if (e.openElements.hasInTableScope(r.TD) || e.openElements.hasInTableScope(r.TH))
      e._closeTableCell(), bu(e, t);
  } else
    G(e, t);
}
function qo(e, t) {
  let u = t.tagID;
  switch (u) {
    case r.TD:
    case r.TH: {
      if (e.openElements.hasInTableScope(u))
        e.openElements.generateImpliedEndTags(), e.openElements.popUntilTagNamePopped(u), e.activeFormattingElements.clearToLastMarker(), e.insertionMode = o.IN_ROW;
      break;
    }
    case r.TABLE:
    case r.TBODY:
    case r.TFOOT:
    case r.THEAD:
    case r.TR: {
      if (e.openElements.hasInTableScope(u))
        e._closeTableCell(), Hi(e, t);
      break;
    }
    case r.BODY:
    case r.CAPTION:
    case r.COL:
    case r.COLGROUP:
    case r.HTML:
      break;
    default:
      Tu(e, t);
  }
}
function Ui(e, t) {
  switch (t.tagID) {
    case r.HTML: {
      G(e, t);
      break;
    }
    case r.OPTION: {
      if (e.openElements.currentTagId === r.OPTION)
        e.openElements.pop();
      e._insertElement(t, m.HTML);
      break;
    }
    case r.OPTGROUP: {
      if (e.openElements.currentTagId === r.OPTION)
        e.openElements.pop();
      if (e.openElements.currentTagId === r.OPTGROUP)
        e.openElements.pop();
      e._insertElement(t, m.HTML);
      break;
    }
    case r.HR: {
      if (e.openElements.currentTagId === r.OPTION)
        e.openElements.pop();
      if (e.openElements.currentTagId === r.OPTGROUP)
        e.openElements.pop();
      e._appendElement(t, m.HTML), t.ackSelfClosing = !0;
      break;
    }
    case r.INPUT:
    case r.KEYGEN:
    case r.TEXTAREA:
    case r.SELECT: {
      if (e.openElements.hasInSelectScope(r.SELECT)) {
        if (e.openElements.popUntilTagNamePopped(r.SELECT), e._resetInsertionMode(), t.tagID !== r.SELECT)
          e._processStartTag(t);
      }
      break;
    }
    case r.SCRIPT:
    case r.TEMPLATE: {
      re(e, t);
      break;
    }
    default:
  }
}
function Qi(e, t) {
  switch (t.tagID) {
    case r.OPTGROUP: {
      if (e.openElements.stackTop > 0 && e.openElements.currentTagId === r.OPTION && e.openElements.tagIDs[e.openElements.stackTop - 1] === r.OPTGROUP)
        e.openElements.pop();
      if (e.openElements.currentTagId === r.OPTGROUP)
        e.openElements.pop();
      break;
    }
    case r.OPTION: {
      if (e.openElements.currentTagId === r.OPTION)
        e.openElements.pop();
      break;
    }
    case r.SELECT: {
      if (e.openElements.hasInSelectScope(r.SELECT))
        e.openElements.popUntilTagNamePopped(r.SELECT), e._resetInsertionMode();
      break;
    }
    case r.TEMPLATE: {
      ke(e, t);
      break;
    }
    default:
  }
}
function jo(e, t) {
  let u = t.tagID;
  if (u === r.CAPTION || u === r.TABLE || u === r.TBODY || u === r.TFOOT || u === r.THEAD || u === r.TR || u === r.TD || u === r.TH)
    e.openElements.popUntilTagNamePopped(r.SELECT), e._resetInsertionMode(), e._processStartTag(t);
  else
    Ui(e, t);
}
function zo(e, t) {
  let u = t.tagID;
  if (u === r.CAPTION || u === r.TABLE || u === r.TBODY || u === r.TFOOT || u === r.THEAD || u === r.TR || u === r.TD || u === r.TH) {
    if (e.openElements.hasInTableScope(u))
      e.openElements.popUntilTagNamePopped(r.SELECT), e._resetInsertionMode(), e.onEndTag(t);
  } else
    Qi(e, t);
}
function $o(e, t) {
  switch (t.tagID) {
    case r.BASE:
    case r.BASEFONT:
    case r.BGSOUND:
    case r.LINK:
    case r.META:
    case r.NOFRAMES:
    case r.SCRIPT:
    case r.STYLE:
    case r.TEMPLATE:
    case r.TITLE: {
      re(e, t);
      break;
    }
    case r.CAPTION:
    case r.COLGROUP:
    case r.TBODY:
    case r.TFOOT:
    case r.THEAD: {
      e.tmplInsertionModeStack[0] = o.IN_TABLE, e.insertionMode = o.IN_TABLE, ze(e, t);
      break;
    }
    case r.COL: {
      e.tmplInsertionModeStack[0] = o.IN_COLUMN_GROUP, e.insertionMode = o.IN_COLUMN_GROUP, Fs(e, t);
      break;
    }
    case r.TR: {
      e.tmplInsertionModeStack[0] = o.IN_TABLE_BODY, e.insertionMode = o.IN_TABLE_BODY, gu(e, t);
      break;
    }
    case r.TD:
    case r.TH: {
      e.tmplInsertionModeStack[0] = o.IN_ROW, e.insertionMode = o.IN_ROW, bu(e, t);
      break;
    }
    default:
      e.tmplInsertionModeStack[0] = o.IN_BODY, e.insertionMode = o.IN_BODY, G(e, t);
  }
}
function e0(e, t) {
  if (t.tagID === r.TEMPLATE)
    ke(e, t);
}
function Yi(e, t) {
  if (e.openElements.tmplCount > 0)
    e.openElements.popUntilTagNamePopped(r.TEMPLATE), e.activeFormattingElements.clearToLastMarker(), e.tmplInsertionModeStack.shift(), e._resetInsertionMode(), e.onEof(t);
  else
    ys(e, t);
}
function t0(e, t) {
  if (t.tagID === r.HTML)
    G(e, t);
  else
    fu(e, t);
}
function vi(e, t) {
  var u;
  if (t.tagID === r.HTML) {
    if (!e.fragmentContext)
      e.insertionMode = o.AFTER_AFTER_BODY;
    if (e.options.sourceCodeLocationInfo && e.openElements.tagIDs[0] === r.HTML) {
      e._setEndLocation(e.openElements.items[0], t);
      let s = e.openElements.items[1];
      if (s && !((u = e.treeAdapter.getNodeSourceCodeLocation(s)) === null || u === void 0 ? void 0 : u.endTag))
        e._setEndLocation(s, t);
    }
  } else
    fu(e, t);
}
function fu(e, t) {
  e.insertionMode = o.IN_BODY, mu(e, t);
}
function u0(e, t) {
  switch (t.tagID) {
    case r.HTML: {
      G(e, t);
      break;
    }
    case r.FRAMESET: {
      e._insertElement(t, m.HTML);
      break;
    }
    case r.FRAME: {
      e._appendElement(t, m.HTML), t.ackSelfClosing = !0;
      break;
    }
    case r.NOFRAMES: {
      re(e, t);
      break;
    }
    default:
  }
}
function s0(e, t) {
  if (t.tagID === r.FRAMESET && !e.openElements.isRootHtmlElementCurrent()) {
    if (e.openElements.pop(), !e.fragmentContext && e.openElements.currentTagId !== r.FRAMESET)
      e.insertionMode = o.AFTER_FRAMESET;
  }
}
function r0(e, t) {
  switch (t.tagID) {
    case r.HTML: {
      G(e, t);
      break;
    }
    case r.NOFRAMES: {
      re(e, t);
      break;
    }
    default:
  }
}
function i0(e, t) {
  if (t.tagID === r.HTML)
    e.insertionMode = o.AFTER_AFTER_FRAMESET;
}
function n0(e, t) {
  if (t.tagID === r.HTML)
    G(e, t);
  else
    lu(e, t);
}
function lu(e, t) {
  e.insertionMode = o.IN_BODY, mu(e, t);
}
function a0(e, t) {
  switch (t.tagID) {
    case r.HTML: {
      G(e, t);
      break;
    }
    case r.NOFRAMES: {
      re(e, t);
      break;
    }
    default:
  }
}
function c0(e, t) {
  t.chars = y, e._insertCharacters(t);
}
function A0(e, t) {
  e._insertCharacters(t), e.framesetOk = !1;
}
function Gi(e) {
  while (e.treeAdapter.getNamespaceURI(e.openElements.current) !== m.HTML && e.openElements.currentTagId !== void 0 && !e._isIntegrationPoint(e.openElements.currentTagId, e.openElements.current))
    e.openElements.pop();
}
function o0(e, t) {
  if (Ii(t))
    Gi(e), e._startTagOutsideForeignContent(t);
  else {
    let u = e._getAdjustedCurrentElement(), s = e.treeAdapter.getNamespaceURI(u);
    if (s === m.MATHML)
      Ds(t);
    else if (s === m.SVG)
      Ci(t), Bs(t);
    if (du(t), t.selfClosing)
      e._appendElement(t, s);
    else
      e._insertElement(t, s);
    t.ackSelfClosing = !0;
  }
}
function d0(e, t) {
  if (t.tagID === r.P || t.tagID === r.BR) {
    Gi(e), e._endTagOutsideForeignContent(t);
    return;
  }
  for (let u = e.openElements.stackTop;u > 0; u--) {
    let s = e.openElements.items[u];
    if (e.treeAdapter.getNamespaceURI(s) === m.HTML) {
      e._endTagOutsideForeignContent(t);
      break;
    }
    let i = e.treeAdapter.getTagName(s);
    if (i.toLowerCase() === t.tagName) {
      t.tagName = i, e.openElements.shortenToLength(u);
      break;
    }
  }
}
// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/node_modules/entities/dist/esm/escape.js
var Xh = String.prototype.codePointAt == null ? (e, t) => (e.charCodeAt(t) & 64512) === 55296 ? (e.charCodeAt(t) - 55296) * 1024 + e.charCodeAt(t + 1) - 56320 + 65536 : e.charCodeAt(t) : (e, t) => e.codePointAt(t);
function Ki(e, t) {
  return function(s) {
    let i, n = 0, a = "";
    while (i = e.exec(s)) {
      if (n !== i.index)
        a += s.substring(n, i.index);
      a += t.get(i[0].charCodeAt(0)), n = i.index + 1;
    }
    return a + s.substring(n);
  };
}
var Wi = /* @__PURE__ */ Ki(/["&\u00A0]/g, /* @__PURE__ */ new Map([
  [34, "&quot;"],
  [38, "&amp;"],
  [160, "&nbsp;"]
])), Ji = /* @__PURE__ */ Ki(/[&<>\u00A0]/g, /* @__PURE__ */ new Map([
  [38, "&amp;"],
  [60, "&lt;"],
  [62, "&gt;"],
  [160, "&nbsp;"]
]));

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/serializer/index.js
var l0 = /* @__PURE__ */ new Set([
  h.AREA,
  h.BASE,
  h.BASEFONT,
  h.BGSOUND,
  h.BR,
  h.COL,
  h.EMBED,
  h.FRAME,
  h.HR,
  h.IMG,
  h.INPUT,
  h.KEYGEN,
  h.LINK,
  h.META,
  h.PARAM,
  h.SOURCE,
  h.TRACK,
  h.WBR
]);
function Zi(e, t) {
  return t.treeAdapter.isElementNode(e) && t.treeAdapter.getNamespaceURI(e) === m.HTML && l0.has(t.treeAdapter.getTagName(e));
}
var h0 = { treeAdapter: z, scriptingEnabled: !0 };
function Ms(e, t) {
  let u = { ...h0, ...t };
  if (Zi(e, u))
    return "";
  return Xi(e, u);
}
function Xi(e, t) {
  let u = "", s = t.treeAdapter.isElementNode(e) && t.treeAdapter.getTagName(e) === h.TEMPLATE && t.treeAdapter.getNamespaceURI(e) === m.HTML ? t.treeAdapter.getTemplateContent(e) : e, i = t.treeAdapter.getChildNodes(s);
  if (i)
    for (let n of i)
      u += f0(n, t);
  return u;
}
function f0(e, t) {
  if (t.treeAdapter.isElementNode(e))
    return E0(e, t);
  if (t.treeAdapter.isTextNode(e))
    return T0(e, t);
  if (t.treeAdapter.isCommentNode(e))
    return g0(e, t);
  if (t.treeAdapter.isDocumentTypeNode(e))
    return b0(e, t);
  return "";
}
function E0(e, t) {
  let u = t.treeAdapter.getTagName(e);
  return `<${u}${m0(e, t)}>${Zi(e, t) ? "" : `${Xi(e, t)}</${u}>`}`;
}
function m0(e, { treeAdapter: t }) {
  let u = "";
  for (let s of t.getAttrList(e)) {
    if (u += " ", s.namespace)
      switch (s.namespace) {
        case m.XML: {
          u += `xml:${s.name}`;
          break;
        }
        case m.XMLNS: {
          if (s.name !== "xmlns")
            u += "xmlns:";
          u += s.name;
          break;
        }
        case m.XLINK: {
          u += `xlink:${s.name}`;
          break;
        }
        default:
          u += `${s.prefix}:${s.name}`;
      }
    else
      u += s.name;
    u += `="${Wi(s.value)}"`;
  }
  return u;
}
function T0(e, t) {
  let { treeAdapter: u } = t, s = u.getTextNodeContent(e), i = u.getParentNode(e), n = i && u.isElementNode(i) && u.getTagName(i);
  return n && u.getNamespaceURI(i) === m.HTML && ri(n, t.scriptingEnabled) ? s : Ji(s);
}
function g0(e, { treeAdapter: t }) {
  return `<!--${t.getCommentNodeContent(e)}-->`;
}
function b0(e, { treeAdapter: t }) {
  return `<!DOCTYPE ${t.getDocumentTypeNodeName(e)}>`;
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5/dist/index.js
function Vi(e, t) {
  return Eu.parse(e, t);
}

// ../../../../home/jf/.claude/skills/html-tree-pruning/node_modules/parse5-htmlparser2-tree-adapter/dist/index.js
function qi(e) {
  let t = e.includes('"') ? "'" : '"';
  return t + e + t;
}
function p0(e, t, u) {
  let s = "!DOCTYPE ";
  if (e)
    s += e;
  if (t)
    s += ` PUBLIC ${qi(t)}`;
  else if (u)
    s += " SYSTEM";
  if (u)
    s += ` ${qi(u)}`;
  return s;
}
var Ee = {
  isCommentNode: xe,
  isElementNode: p,
  isTextNode: W,
  createDocument() {
    let e = new X([]);
    return e["x-mode"] = Y.NO_QUIRKS, e;
  },
  createDocumentFragment() {
    return new X([]);
  },
  createElement(e, t, u) {
    let s = Object.create(null), i = Object.create(null), n = Object.create(null);
    for (let d = 0;d < u.length; d++) {
      let l = u[d].name;
      s[l] = u[d].value, i[l] = u[d].namespace, n[l] = u[d].prefix;
    }
    let a = new Te(e, s, []);
    return a.namespace = t, a["x-attribsNamespace"] = i, a["x-attribsPrefix"] = n, a;
  },
  createCommentNode(e) {
    return new Qe(e);
  },
  createTextNode(e) {
    return new ce(e);
  },
  appendChild(e, t) {
    let u = e.children[e.children.length - 1];
    if (u)
      u.next = t, t.prev = u;
    e.children.push(t), t.parent = e;
  },
  insertBefore(e, t, u) {
    let s = e.children.indexOf(u), { prev: i } = u;
    if (i)
      i.next = t, t.prev = i;
    u.prev = t, t.next = u, e.children.splice(s, 0, t), t.parent = e;
  },
  setTemplateContent(e, t) {
    Ee.appendChild(e, t);
  },
  getTemplateContent(e) {
    return e.children[0];
  },
  setDocumentType(e, t, u, s) {
    let i = p0(t, u, s), n = e.children.find((a) => yt(a) && a.name === "!doctype");
    if (n)
      n.data = i !== null && i !== void 0 ? i : null;
    else
      n = new Ye("!doctype", i), Ee.appendChild(e, n);
    n["x-name"] = t, n["x-publicId"] = u, n["x-systemId"] = s;
  },
  setDocumentMode(e, t) {
    e["x-mode"] = t;
  },
  getDocumentMode(e) {
    return e["x-mode"];
  },
  detachNode(e) {
    if (e.parent) {
      let t = e.parent.children.indexOf(e), { prev: u, next: s } = e;
      if (e.prev = null, e.next = null, u)
        u.next = s;
      if (s)
        s.prev = u;
      e.parent.children.splice(t, 1), e.parent = null;
    }
  },
  insertText(e, t) {
    let u = e.children[e.children.length - 1];
    if (u && W(u))
      u.data += t;
    else
      Ee.appendChild(e, Ee.createTextNode(t));
  },
  insertTextBefore(e, t, u) {
    let s = e.children[e.children.indexOf(u) - 1];
    if (s && W(s))
      s.data += t;
    else
      Ee.insertBefore(e, Ee.createTextNode(t), u);
  },
  adoptAttributes(e, t) {
    for (let u = 0;u < t.length; u++) {
      let s = t[u].name;
      if (e.attribs[s] === void 0)
        e.attribs[s] = t[u].value, e["x-attribsNamespace"][s] = t[u].namespace, e["x-attribsPrefix"][s] = t[u].prefix;
    }
  },
  getFirstChild(e) {
    return e.children[0];
  },
  getChildNodes(e) {
    return e.children;
  },
  getParentNode(e) {
    return e.parent;
  },
  getAttrList(e) {
    return e.attributes;
  },
  getTagName(e) {
    return e.name;
  },
  getNamespaceURI(e) {
    return e.namespace;
  },
  getTextNodeContent(e) {
    return e.data;
  },
  getCommentNodeContent(e) {
    return e.data;
  },
  getDocumentTypeNodeName(e) {
    var t;
    return (t = e["x-name"]) !== null && t !== void 0 ? t : "";
  },
  getDocumentTypeNodePublicId(e) {
    var t;
    return (t = e["x-publicId"]) !== null && t !== void 0 ? t : "";
  },
  getDocumentTypeNodeSystemId(e) {
    var t;
    return (t = e["x-systemId"]) !== null && t !== void 0 ? t : "";
  },
  isDocumentTypeNode(e) {
    return yt(e) && e.name === "!doctype";
  },
  setNodeSourceCodeLocation(e, t) {
    if (t)
      e.startIndex = t.startOffset, e.endIndex = t.endOffset;
    e.sourceCodeLocation = t;
  },
  getNodeSourceCodeLocation(e) {
    return e.sourceCodeLocation;
  },
  updateNodeSourceCodeLocation(e, t) {
    if (t.endOffset != null)
      e.endIndex = t.endOffset;
    e.sourceCodeLocation = {
      ...e.sourceCodeLocation,
      ...t
    };
  }
};

// prune.ts
var { values: Pe, positionals: C0 } = I0({
  allowPositionals: !0,
  options: {
    scope: { type: "string" },
    ignore: { type: "string", multiple: !0, default: [] },
    "base-url": { type: "string" }
  }
}), ji = C0[0] ?? "-", _0 = ji === "-" ? await Bun.stdin.text() : await Bun.file(ji).text(), ie = $r(Vi(_0, { treeAdapter: Ee }));
for (let e of Pe.ignore)
  ie(e).remove();
ie("script, style, link, meta, base, template, noscript, svg, input[type='hidden' i], [hidden], [aria-hidden='true']").remove();
var ws = Pe.scope ? ie(Pe.scope).first() : ie("body");
if (!ws.length)
  console.error(`--scope matched nothing: ${Pe.scope}`), process.exit(1);
var N0 = /* @__PURE__ */ new Set([
  "href",
  "src",
  "alt",
  "title",
  "role",
  "aria-label",
  "aria-expanded",
  "aria-checked",
  "aria-selected",
  "type",
  "name",
  "value",
  "placeholder",
  "checked",
  "selected",
  "disabled",
  "multiple",
  "required",
  "for",
  "id",
  "colspan",
  "rowspan",
  "scope",
  "start",
  "reversed",
  "datetime",
  "open"
]), St = /* @__PURE__ */ new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "br",
  "caption",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "optgroup",
  "option",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul"
]), pu = new Te("body", {});
ie(pu).append(Pe.scope ? ws : ws.contents());
var zi = /* @__PURE__ */ new Set;
ie(pu).find("label[for], a[href^='#']").each((e, t) => {
  let u = ie(t);
  zi.add(u.attr("for") ?? u.attr("href").slice(1));
});
function $i(e, t = !1) {
  if (e.type === "comment") {
    ie(e).remove();
    return;
  }
  if (e.type === "text") {
    if (!t)
      e.data = e.data.replace(/[\t\n\r\f ]+/g, " ");
    return;
  }
  if (!p(e))
    return;
  let u = ie(e), s = t || e.name === "pre" || e.name === "textarea";
  if (e.name === "img" && (!u.attr("src") || u.attr("src").startsWith("data:"))) {
    let i = u.attr("data-src") ?? u.attr("data-lazy-src") ?? u.attr("data-original");
    if (i)
      u.attr("src", i);
  }
  for (let i of Object.keys(e.attribs))
    if (!N0.has(i) || i === "id" && !zi.has(e.attribs[i]))
      u.removeAttr(i);
  if (Pe["base-url"])
    for (let i of ["href", "src"]) {
      let n = u.attr(i);
      if (n && !n.startsWith("#"))
        u.attr(i, URL.parse(n, Pe["base-url"])?.href ?? n);
    }
  for (let i of [...e.children])
    $i(i, s);
  if (s)
    return;
  for (let i of [...e.children])
    if (i.type === "text" && i.prev?.type === "text")
      i.data = (i.prev.data + i.data).replace(/ +/g, " "), ie(i.prev).remove();
  for (let i of [...e.children]) {
    if (i.type !== "text")
      continue;
    let { prev: n, next: a } = i;
    if (n ? p(n) && St.has(n.name) : St.has(e.name))
      i.data = i.data.replace(/^ /, "");
    if (a ? p(a) && St.has(a.name) : St.has(e.name))
      i.data = i.data.replace(/ $/, "");
    if (!i.data)
      ie(i).remove();
  }
  if (Object.keys(e.attribs).length)
    return;
  if (e.name === "span")
    u.replaceWith(u.contents());
  else if (e.name === "div") {
    if (!e.children.length)
      u.remove();
    else if (e.children.length === 1 && p(e.children[0]) && St.has(e.children[0].name))
      u.replaceWith(u.contents());
  }
}
$i(pu);
console.log(Ms(pu, { treeAdapter: Ee }));

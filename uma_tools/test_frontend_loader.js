"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// The VM supplies a DOM fixture and real Vue reactivity. Only module loading is
// adapted; every state transition executes the same factory used by the browser.
function loadFrontend(context) {
  const directory = path.join(__dirname, "frontend");
  const wiring = fs.readFileSync(path.join(directory, "domains.js"), "utf8");
  const imports = Array.from(
    wiring.matchAll(
      /import\s*\{\s*(\w+)\s*\}\s*from "\/uma_tools\/frontend\/domains\/([\w-]+)\.js";/g,
    ),
  );
  for (const [, name, file] of imports) {
    const source = fs
      .readFileSync(path.join(directory, "domains", file + ".js"), "utf8")
      .replace("export function " + name, "function " + name);
    context[name] = vm.runInContext('(function(){' + source + ';return ' + name + ';})()', context, { filename: file + '.js' });
  }
  vm.runInContext(
    wiring
      .replace(/^import .*;\n/gm, "")
      .replace("export function createDomains", "function createDomains"),
    context,
    { filename: "domains.js" },
  );
  for (const name of ["view-model", "pages", "components"]) {
    const module = fs
      .readFileSync(path.join(directory, name + ".js"), "utf8")
      .replace(/export function /g, "function ");
    const exported = { 'view-model': 'createViewModel', pages: 'registerPages', components: 'registerComponents' }[name];
    context[exported] = vm.runInContext('(function(){' + module + ';return ' + exported + ';})()', context, { filename: name + '.js' });
  }
  const entry = fs
    .readFileSync(path.join(__dirname, "app.js"), "utf8")
    .replace(/^import .*;\n/gm, "");
  vm.runInContext(entry, context, { filename: "app.js" });
}
module.exports = { loadFrontend };

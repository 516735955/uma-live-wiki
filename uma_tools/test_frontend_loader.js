"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');

// The VM supplies a DOM fixture and real Vue reactivity. Only module loading is
// adapted; every state transition executes the same factory used by the browser.
function loadFrontend(context) {
  context.preloadPage = async () => {};
  context.installNavigationPrefetch = () => () => {};
  const directory = path.join(__dirname, "frontend");
  const performers = read(path.join(directory, 'performer-groups.js')).replace(/export (const|function) /g, '$1 ');
  Object.assign(context, vm.runInContext('(function(){' + performers + ';return {castGroups,performanceGroups,groupSetlistPerformers,PerformanceCast};})()', context));
  const wiring = read(path.join(directory, "domains.js"));
  const labels = read(path.join(directory, 'anime-labels.js')).replace(/export function /g, 'function ');
  Object.assign(context, vm.runInContext('(function(){' + labels + ';return {animeFormatLabel,animeStatusLabel,animePlatformLabel};})()', context));
  for (const [file, name] of [['anime-participation', 'createAnimeParticipation'], ['anime-music', 'createAnimeMusic']]) {
    const source = read(path.join(directory, file + '.js')).replace('export function ' + name, 'function ' + name);
    context[name] = vm.runInContext('(function(){' + source + ';return ' + name + ';})()', context, { filename: file + '.js' });
  }
  const contentStateSource = read(path.join(directory, 'content-state.js'))
    .replace('export const ContentState', 'const ContentState');
  context.ContentState = vm.runInContext('(function(){' + contentStateSource + ';return ContentState;})()', context, { filename: 'content-state.js' });
  const activitySource = read(path.join(directory, 'activity-components.js')).replace(/export (const|function) /g, '$1 ');
  Object.assign(context, vm.runInContext('(function(){' + activitySource + ';return {ActivityTime,ActivityHistory};})()', context, { filename: 'activity-components.js' }));
  const imports = Array.from(
    wiring.matchAll(
      /import\s*\{\s*(\w+)\s*\}\s*from "\/uma_tools\/frontend\/domains\/([\w-]+)\.js";/g,
    ),
  );
  for (const [, name, file] of imports) {
    const source = read(path.join(directory, "domains", file + ".js"))
      .replace("export function " + name, "function " + name).replace(/import\s+[\s\S]*?\sfrom\s+"[^"]+";\n/g, '');
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
    const module = read(path.join(directory, name + ".js"))
      .replace(/^import .*;\n/gm, "")
      .replace(/export function /g, "function ");
    const exported = { 'view-model': 'createViewModel', pages: 'registerPages', components: 'registerComponents' }[name];
    context[exported] = vm.runInContext('(function(){' + module + ';return ' + exported + ';})()', context, { filename: name + '.js' });
  }
  const entry = read(path.join(__dirname, "app.js"))
    .replace(/^import .*;\n/gm, "");
  vm.runInContext(entry, context, { filename: "app.js" });
}
module.exports = { loadFrontend };

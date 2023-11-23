'use strict';

const path = require('path').posix;

const BUILDER_CONFIG_JSON = 'config.json';

const GIT_PATH = '/ws/git/';

const REQUIRED_PATHS = {
   logs: '/ws/logs',
   output: '/ws/output',
   cache: '/ws/cache/builder',
   tsconfig: '/ws/tsconfig.json'
};

const ADDITIONAL_OPTIONS = {
   symlinks: false,
   clearOutput: false,
   moduleType: 'umd',
   tsc: true,
   mode: 'stand',
   typescript: true,
   contents: true,
   joinedMeta: true,
   less: true,
   resourcesUrl: true,
   outputIsCache: true,
   useReact: true,
   branchTests: true,
   lessCoverage: true,
   presentationServiceMeta: true,
   localization: [
      'en-US',
      'ru-RU'
   ],
   'default-localization': 'ru-RU',
   deprecatedStaticHtml: false,
   deprecatedXhtml: true,
   deprecatedWebPageTemplates: true,
   deprecatedOwnDependencies: true,
   'multi-service': false,
   'url-service-path': '/',
   'ui-service-path': '/',
   'url-default-service-path': '',
   minimize: true,
   wml: true,
   customPack: true,
   dependenciesGraph: true,
   htmlWml: true,
};

function ensureOptions(options) {
   const opts = options || {};
   const mods = opts.modules || [];

   return {
      ...REQUIRED_PATHS,
      ...opts,
      ...mods
   };
}

function toModule(options) {
   return {
      id: 'unspecified',
      path: path.join(GIT_PATH, options.name),
      depends: [],
      service: [],
      changedFiles: [],
      deletedFiles: [],
      ...options,
   };
}

function createConfigFile(options) {
   const config = ensureOptions(options);

   return {
      ...ADDITIONAL_OPTIONS,
      ...config,
      modules: [
         ...config.modules.map(toModule)
      ]
   };
}

module.exports = {
   BUILDER_CONFIG_JSON,
   REQUIRED_PATHS,
   createConfigFile
};

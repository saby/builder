/**
 * Набор базовых констант, используемых в тасках Gulp
 * @author Kolbeshin F.A.
 */
'use strict';

const os = require('os');
const supportedBrowsers = [
   'Chrome>=75',
   'Firefox>=79',
   'iOS>=12',
   'Opera>=71',
   'Safari>=14.0'
];
const supportedBrowsersForIEApp = [
   'Chrome>=52',
   'Firefox>=51',
   'iOS>=12',
   'Opera>=44',
   'Safari>=12.0',
   'ie>=11'
];
module.exports = {
   metaFolder: '/.builder/',
   oldThemes: [
      'carry',
      'carry_medium',
      'carrynew',
      'carrynew_medium',
      'online',
      'presto',
      'presto_medium',
      'prestonew',
      'prestonew_medium',
      'plugin'
   ],
   defaultAutoprefixerOpts: { grid: true, browsers: supportedBrowsers, remove: false },
   defaultAutoprefixerOptsForIEApp: { grid: true, browsers: supportedBrowsersForIEApp, remove: false },
   supportedBrowsers,
   supportedBrowsersForIEApp,
   requireJsSubstitutions: new Map([
      ['WS.Core/lib', 'Lib'],
      ['WS.Core/lib/Ext', 'Ext'],
      ['WS.Core/core', 'Core'],
      ['WS.Core/transport', 'Transport'],
      ['WS.Core/css', 'WS/css'],
      ['WS.Deprecated', 'Deprecated'],
      ['WS.Core/ext/requirejs/plugins', '']
   ]),
   requirejsPlugins: [
      'wml',
      'tmpl',
      'html',
      'xhtml',
      'css',
      'jstpl',
      'json',
      'text',
      'i18n'
   ],
   pluginsForModuleDependencies: [
      'is',
      'html',
      'css',
      'json',
      'xml',
      'text',
      'native-css',
      'browser',
      'optional',
      'i18n',
      'tmpl',
      'wml',
      'cdn',
      'preload',
      'remote'
   ],
   pluginsRegex: /!|\?/,
   invalidCharsForVariable: /\/|\?|!|-|\./g,
   stylesToExcludeFromMinify: [
      /.*\.min\.css$/,
      /[/\\]service[/\\].*/
   ],
   isWindows: process.platform === 'win32',
   defaultCssVariablesOptions: {

      // this options allows us to build default value for css class and
      // save dynamic variable definition
      preserve: true,

      // don't save variables that was paste in during current less file
      // build to avoid generating of useless css code in each compiled
      // less file
      preserveInjectedVariables: false
   },

   // https://docs.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation
   // When using an API to create a directory, the specified path cannot be so long that
   // you cannot append an 8.3 file name (that is, the directory name cannot exceed MAX_PATH minus 12).
   // https://unix.stackexchange.com/questions/32795/what-is-the-maximum-allowed-filename-and-folder-size-with-ecryptfs
   // Linux has a maximum filename length of 255 characters for most filesystems (including EXT4),
   // and a maximum path of 4096 characters.
   MAX_PATH: process.platform === 'win32' ? 248 : 4096,

   // Warning: parameter --max-old-space-size accepts value in MB
   //          function os.totalmem() returns the total amount of system memory in B.
   TOTAL_MEMORY: Math.round(process.env.SBIS_TOTAL_MEMORY || (os.totalmem() / 1024 / 1024)),
   CPUS_COUNT: os.cpus().length,
   TS_EXT: /(\.meta)?\.(tsx?)$/,
   HTML_MINIFY_OPTIONS: {
      collapseWhitespace: true,
      minifyJS: true,
      minifyCSS: true,
      processScripts: ['text/html'],
      ignoreCustomFragments: [/<#=.+?#>/],
      quoteCharacter: "'",
      keepClosingSlash: true,
      caseSensitive: true,
      continueOnParseError: true
   },
   CURRENCY_GLYPH_MAP: {
      KZ: {
         '\\e6a3': '\\eba4',
         '\\e9cd': '\\eba5'
      },
      UZ: {
         '\\e6a3': '\\eba6',
         '\\e9cd': '\\eba7'
      }
   }
};

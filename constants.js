'use strict';

// list of constants for builder scripts from package.json
module.exports = {
   REPOS: {
      rmi: 'git@git.sbis.ru:sbis/rmi.git',
      'sbis3-ws': 'git@git.sbis.ru:sbis/ws.git',
      'saby-i18n': 'git@git.sbis.ru:saby/i18n.git',
      Router: 'git@git.sbis.ru:saby/router.git',
      'saby-types': 'git@git.sbis.ru:saby/types.git',
      'wasaby-app': 'git@git.sbis.ru:saby/wasaby-app.git',
      'saby-ui': 'git@git.sbis.ru:saby/ui.git',
      'wasaby-requirejs-loader': 'git@git.sbis.ru:saby/wasaby-requirejs-loader.git',
      'saby-react': 'git@git.sbis.ru:saby/react.git',
      'sbis-core': 'git@git.sbis.ru:sbis/core.git'
   },

   /**
    * List of files of builder code that should cause full builder cache reset due to theirs
    * code updates
    * @type {string[]}
    */
   FILES_FOR_BUILDER_HASH: [
      '/less/',
      '/pack/',
      '/templates/',
      '/espree/',
      '/es-converter/',
      '/changed-files/',
      '/platform',
      'gulp/builder/',
      'gulp/common/',
      'compile-less.js',
      'build-tmpl.js',
      'build-xhtml.js',
      'modules-cache.js',
      'cache.js',
      'custom-packer.js',
      'configuration.js',
      'remove-outdated-files.js',
      'versionize-content.js',
      'process-sabytheme.js',
      'builderVersion'
   ]
};

'use strict';

// list of constants for builder scripts from package.json
module.exports = {
   REPOS: {
      rmi: 'https://git.sbis.ru/sbis/rmi.git',
      'sbis3-ws': 'https://git.sbis.ru/sbis/ws.git',
      'saby-i18n': 'https://git.sbis.ru/saby/i18n.git',
      Router: 'https://git.sbis.ru/saby/router.git',
      'saby-types': 'https://git.sbis.ru/saby/Types.git',
      'wasaby-app': 'https://git.sbis.ru/saby/wasaby-app.git',
      'saby-ui': 'https://git.sbis.ru/saby/UI.git',
      'saby-inferno': 'https://git.sbis.ru/saby/inferno.git',
      'wasaby-requirejs-loader': 'https://git.sbis.ru/saby/wasaby-requirejs-loader.git',
      'saby-react': 'https://git.sbis.ru/saby/react.git',
      'sbis-core': 'https://git.sbis.ru/sbis/core.git'
   },

   /**
    * List of files of builder code that should cause full builder cache reset due to theirs
    * code updates
    * @type {string[]}
    */
   FILES_FOR_BUILDER_HASH: [
      '/less/',
      '/templates/',
      'gulp/builder/',
      'compile-less.js',
      'build-tmpl.js',
      'build-xhtml.js',
      'modules-cache.js',
      'cache.js',
      'custom-packer.js',
      'configuration.js',
      'remove-outdated-files.js'
   ]
};

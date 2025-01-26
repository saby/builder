'use strict';

const { expect } = require('chai');

const Generator = require('../lib/pagex/generator');
const Schema = require('./pagex-generator.test.json');

function createGenerator() {
   const generator = new Generator(Schema.modules);

   Schema.modules.forEach((module) => {
      module.files.js.forEach(([moduleName, depends]) => {
         generator.addJsFile(`${moduleName}.ts`, moduleName, depends);
      });
      module.files.css.forEach((filePath) => {
         generator.addCssFile(filePath);
      });
      module.files.json.forEach((filePath) => {
         generator.addJsonFile(filePath);
      });
   });

   generator.fillMissingModules();

   generator.loadLayouts({
      first: ['First/bbb:Entity'],
      second: ['Second/bbb:Entity'],
      third: ['Third/bbb:Entity'],
      custom: []
   });

   generator.loadPages('Module/file.pagex', [{
      id: 'page-1',
      type: 'first',
      modules: ['First/aaa']
   }, {
      id: 'page-2',
      type: 'custom',
      modules: ['Second/aaa']
   }, {
      id: 'page-3',
      type: 'third',
      modules: ['Third/aaa']
   }]);

   return generator;
}

function toJson(packages) {
   const oPackages = {
      layouts: {},
      contents: {}
   };

   packages.layouts.packages.set('common', packages.layouts.common);
   packages.layouts.packages.forEach((value, key) => {
      oPackages.layouts[key] = value.toJSON();
   });

   packages.contents.packages.set('common', packages.contents.common);
   packages.contents.packages.forEach((value, key) => {
      oPackages.contents[key] = value.toJSON();
   });

   return oPackages;
}

describe('lib/pagex/generator', () => {
   const generator = createGenerator();

   it('should generate package map', () => {
      const result = toJson(generator.allocate({
         layout: {
            quota: 0.5
         },
         content: {
            quota: 0.5
         }
      }));

      expect(result).to.deep.equal({
         'layouts': {
            'first': {
               'i18n': [],
               'css': [],
               'js': [
                  'First/bbb',
                  'First/ccc',
                  'json!First/file.json'
               ]
            },
            'second': {
               'i18n': [],
               'css': [],
               'js': [
                  'Second/bbb',
                  'Second/ccc',
                  'json!Second/file.json'
               ]
            },
            'third': {
               'i18n': [],
               'css': [],
               'js': [
                  'Third/bbb',
                  'Third/ccc',
                  'json!Third/file.json'
               ]
            },
            'common': {
               'i18n': [],
               'css': [],
               'js': []
            }
         },
         'contents': {
            'page-1': {
               'i18n': [],
               'css': [
                  'css!First/style'
               ],
               'js': [
                  'First/aaa',
                  'First/ddd',
                  'First/eee'
               ]
            },
            'page-2': {
               'i18n': [],
               'css': [],
               'js': []
            },
            'page-3': {
               'i18n': [],
               'css': [],
               'js': []
            },
            'common': {
               'i18n': [],
               'css': [
                  'css!Second/style',
                  'css!Third/style'
               ],
               'js': [
                  'Second/aaa',
                  'Second/ddd',
                  'Third/aaa',
                  'Third/ddd'
               ]
            }
         }
      });
   });

   it('should generate package map with required common modules', () => {
      const result = toJson(generator.allocate({
         layout: {
            requiredCommon: [
               'First/bbb',
               'Second/bbb',
               'Third/bbb'
            ],
            quota: 0.5
         },
         content: {
            requiredCommon: [
               'First/aaa'
            ],
            quota: 0.5
         }
      }));

      expect(result).to.deep.equal({
         'layouts': {
            'first': {
               'i18n': [],
               'css': [],
               'js': [
                  'First/ccc',
                  'json!First/file.json'
               ]
            },
            'second': {
               'i18n': [],
               'css': [],
               'js': [
                  'Second/ccc',
                  'json!Second/file.json'
               ]
            },
            'third': {
               'i18n': [],
               'css': [],
               'js': [
                  'Third/ccc',
                  'json!Third/file.json'
               ]
            },
            'common': {
               'i18n': [],
               'css': [],
               'js': [
                  'First/bbb',
                  'Second/bbb',
                  'Third/bbb'
               ]
            }
         },
         'contents': {
            'page-1': {
               'i18n': [],
               'css': [
                  'css!First/style'
               ],
               'js': [
                  'First/ddd',
                  'First/eee'
               ]
            },
            'page-2': {
               'i18n': [],
               'css': [],
               'js': []
            },
            'page-3': {
               'i18n': [],
               'css': [],
               'js': []
            },
            'common': {
               'i18n': [],
               'css': [
                  'css!Second/style',
                  'css!Third/style'
               ],
               'js': [
                  'First/aaa',
                  'Second/aaa',
                  'Second/ddd',
                  'Third/aaa',
                  'Third/ddd'
               ]
            }
         }
      });
   });

   it('should generate only common packages', () => {
      const result = toJson(generator.allocate({
         layout: {
            quota: 0.1
         },
         content: {
            quota: 0.1
         }
      }));

      const EMPTY_PACKAGE = {
         'i18n': [],
         'css': [],
         'js': []
      };

      expect(result).to.deep.equal({
         'layouts': {
            'first': EMPTY_PACKAGE,
            'second': EMPTY_PACKAGE,
            'third': EMPTY_PACKAGE,
            'common': {
               'i18n': [],
               'css': [],
               'js': [
                  'First/bbb',
                  'First/ccc',
                  'Second/bbb',
                  'Second/ccc',
                  'Third/bbb',
                  'Third/ccc',
                  'json!First/file.json',
                  'json!Second/file.json',
                  'json!Third/file.json'
               ]
            }
         },
         'contents': {
            'page-1': EMPTY_PACKAGE,
            'page-2': EMPTY_PACKAGE,
            'page-3': EMPTY_PACKAGE,
            'common': {
               'i18n': [],
               'css': [
                  'css!First/style',
                  'css!Second/style',
                  'css!Third/style'
               ],
               'js': [
                  'First/aaa',
                  'First/ddd',
                  'First/eee',
                  'Second/aaa',
                  'Second/ddd',
                  'Third/aaa',
                  'Third/ddd'
               ]
            }
         }
      });
   });

   it('should generate only special packages', () => {
      const result = toJson(generator.allocate({
         layout: {
            quota: 0.9
         },
         content: {
            quota: 0.9
         }
      }));

      const EMPTY_PACKAGE = {
         'i18n': [],
         'css': [],
         'js': []
      };

      expect(result).to.deep.equal({
         'layouts': {
            'first': {
               'i18n': [],
               'css': [],
               'js': [
                  'First/bbb',
                  'First/ccc',
                  'json!First/file.json'
               ]
            },
            'second': {
               'i18n': [],
               'css': [],
               'js': [
                  'Second/bbb',
                  'Second/ccc',
                  'json!Second/file.json'
               ]
            },
            'third': {
               'i18n': [],
               'css': [],
               'js': [
                  'Third/bbb',
                  'Third/ccc',
                  'json!Third/file.json'
               ]
            },
            'common': EMPTY_PACKAGE
         },
         'contents': {
            'page-1': {
               'i18n': [],
               'css': [
                  'css!First/style',
                  'css!Second/style',
                  'css!Third/style'
               ],
               'js': [
                  'First/aaa',
                  'First/ddd',
                  'First/eee',
                  'Second/aaa',
                  'Second/ddd',
                  'Third/aaa',
                  'Third/ddd'
               ]
            },
            'page-2': {
               'i18n': [],
               'css': [
                  'css!Second/style'
               ],
               'js': [
                  'Second/aaa',
                  'Second/ddd'
               ]
            },
            'page-3': {
               'i18n': [],
               'css': [
                  'css!Third/style'
               ],
               'js': [
                  'Third/aaa',
                  'Third/ddd'
               ]
            },
            'common': EMPTY_PACKAGE
         }
      });
   });
});

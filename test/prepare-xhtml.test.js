/* eslint-disable global-require */
'use strict';

const initTest = require('./init-test');

let prepareXhtml;

describe('i18n', () => {
   before(async() => {
      await initTest();
      prepareXhtml = require('../lib/i18n/prepare-xhtml');
   });

   describe('prepare XHTML', () => {
      it('empty file', () => {
         const result = prepareXhtml('', {});
         result.should.equal('');
      });

      it('simple div and span', () => {
         const text = '<div>Текст</div><span>Текст</span><!--<div>Текст3</div><span>Текст4</span>-->';
         const result = prepareXhtml(text, {});
         result.should.equal('<div>{[Текст]}</div><span>{[Текст]}</span>');
      });

      // title в теге <а>
      it('simple a title', () => {
         const text = '<a href="/" title="Текст">';
         const result = prepareXhtml(text, {});
         result.should.equal('<a href="/" title="{[Текст]}">');
      });

      // несколько видов задания простых опций
      it('simple component option', () => {
         const text =
            '<component data-component="Test.Component">\n' +
            '   <option name="test1">Текст1</option>\n' +
            '   <option name="test2" value="Текст2"></option>\n' +
            '   <opt name="test3">Текст3</opt>\n' +
            '   <opt name="test4" value="Текст4"></opt>\n' +
            '   <option name="not_translatable1" value="Текст5"></option>\n' +
            '   <opt name="not_translatable2" value="Текст6"></opt>\n' +
            '</component>';
         const componentsProperties = {
            'Test.Component': {
               properties: {
                  'ws-config': {
                     options: {
                        test1: {
                           translatable: true
                        },
                        test2: {
                           translatable: true
                        },
                        test3: {
                           translatable: true
                        },
                        test4: {
                           translatable: true
                        }
                     }
                  }
               }
            }
         };
         const result = prepareXhtml(text, componentsProperties);
         result.should.equal(
            '<component data-component="Test.Component">\n' +
               '   <option name="test1">{[Текст1]}</option>\n' +
               '   <option name="test2" value="{[Текст2]}"></option>\n' +
               '   <opt name="test3">{[Текст3]}</opt>\n' +
               '   <opt name="test4" value="{[Текст4]}"></opt>\n' +
               '   <option name="not_translatable1" value="Текст5"></option>\n' +
               '   <opt name="not_translatable2" value="Текст6"></opt>\n' +
               '</component>'
         );
      });

      // опции с версткой - тип content
      it('content component option', () => {
         const text =
            '<component data-component="Test.Component">\n' +
            '   <option name="contentOpt"><div>Текст</div></option>\n' +
            '</component>';
         const componentsProperties = {
            'Test.Component': {
               properties: {
                  'ws-config': {
                     options: {
                        contentOpt: {
                           translatable: true,
                           type: 'Content'
                        }
                     }
                  }
               }
            }
         };
         const result = prepareXhtml(text, componentsProperties);
         result.should.equal(
            '<component data-component="Test.Component">\n' +
               '   <option name="contentOpt"><div>{[Текст]}</div></option>\n' +
               '</component>'
         );
      });

      // опции с версткой - тип content, но в самом шаблоне тип String
      it('content component option, but templates string', () => {
         const text =
            '<component data-component="Test.Component">\n' +
            '   <option name="contentOpt">Текст</option>\n' +
            '</component>';
         const componentsProperties = {
            'Test.Component': {
               properties: {
                  'ws-config': {
                     options: {
                        contentOpt: {
                           translatable: true,
                           type: 'Content'
                        }
                     }
                  }
               }
            }
         };
         const result = prepareXhtml(text, componentsProperties);
         result.should.equal(
            '<component data-component="Test.Component">\n' +
               '   <option name="contentOpt">{[Текст]}</option>\n' +
               '</component>'
         );
      });

      // опции-массивы
      it('array component option', () => {
         const text =
            '<component data-component="Test.Component">\n' +
            '   <options name="arrayOpt" type="array">' +
            '      <options>' +
            '         <option name="test">Текст</option>' +
            '      </options>' +
            '   </options>\n' +
            '</component>';
         const componentsProperties = {
            'Test.Component': {
               properties: {
                  'ws-config': {
                     options: {
                        arrayOpt: {
                           itemType: 'Items.typedef',
                           type: 'array'
                        }
                     }
                  }
               }
            },
            'Items.typedef': {
               properties: {
                  'ws-config': {
                     options: {
                        test: {
                           translatable: true
                        }
                     }
                  }
               }
            }
         };
         const result = prepareXhtml(text, componentsProperties);
         result.should.equal(
            '<component data-component="Test.Component">\n' +
               '   <options name="arrayOpt" type="array">' +
               '      <options>' +
               '         <option name="test">{[Текст]}</option>' +
               '      </options>' +
               '   </options>\n' +
               '</component>'
         );
      });

      // опции-массивы c рекурсией
      it('recursive array component option', () => {
         // меню - классический пример рекурсивных опций
         const text =
            '<component data-component="Deprecated/Controls/Menu/Menu" name="Menu">\n' +
            '   <options name="data" type="array">\n' +
            '      <options>\n' +
            '         <option name="caption">Тест1</option>\n' +
            '         <option name="id">1</option>\n' +
            '      </options>\n' +
            '      <options>\n' +
            '         <option name="caption">Тест2</option>\n' +
            '         <option name="id">2</option>\n' +
            '         <options name="subMenu" type="array">\n' +
            '            <options>\n' +
            '               <option name="caption">Тест3</option>\n' +
            '               <option name="id">3</option>\n' +
            '            </options>\n' +
            '         </options>\n' +
            '      </options>\n' +
            '   </options>\n' +
            '</component>';
         const componentsProperties = {
            'Deprecated/Controls/Menu/Menu': {
               properties: {
                  'ws-config': {
                     options: {
                        data: {
                           itemType: 'Deprecated/Controls/Menu/Menu/Dictionary.typedef',
                           title: 'Массив данных для отображения в меню',
                           type: 'Array'
                        }
                     }
                  }
               }
            },
            'Deprecated/Controls/Menu/Menu/Dictionary.typedef': {
               properties: {
                  'ws-config': {
                     title: 'Базовая конфигурация',
                     options: {
                        caption: {
                           title: 'Заголовок элемента меню.',
                           translatable: true,
                           type: 'String'
                        },
                        id: {
                           title: 'Идентификатор соответствующего пункта меню.',
                           type: 'String'
                        },
                        subMenu: {
                           itemType: 'Deprecated/Controls/Menu/Menu/Dictionary.typedef',
                           title: 'Подменю указанного пункта, описывается аналогично описанному выше.',
                           type: 'Array'
                        }
                     }
                  }
               }
            }
         };
         const result = prepareXhtml(text, componentsProperties);
         result.should.equal(
            '<component data-component="Deprecated/Controls/Menu/Menu" name="Menu">\n' +
               '   <options name="data" type="array">\n' +
               '      <options>\n' +
               '         <option name="caption">{[Тест1]}</option>\n' +
               '         <option name="id">1</option>\n' +
               '      </options>\n' +
               '      <options>\n' +
               '         <option name="caption">{[Тест2]}</option>\n' +
               '         <option name="id">2</option>\n' +
               '         <options name="subMenu" type="array">\n' +
               '            <options>\n' +
               '               <option name="caption">{[Тест3]}</option>\n' +
               '               <option name="id">3</option>\n' +
               '            </options>\n' +
               '         </options>\n' +
               '      </options>\n' +
               '   </options>\n' +
               '</component>'
         );
      });
   });
});

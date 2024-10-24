/* eslint-disable no-unused-expressions */
'use strict';

const { expect } = require('chai');

const TailwindTreeShaker = require('../lib/tailwind/tree-shaker');

describe('lib/tw-tree-shaker', () => {
   describe('should generate snapshot from scratch', () => {
      it('should build full snapshot', () => {
         const source = (`
         .container{ width:100% }
         @media (min-width:640px){
             .container{ max-width:640px }
         }
         @media (min-width:1024px){
             .lg\\:container{ width:100% }
             @media (min-width:640px){
                 .lg\\:container{ max-width:640px }
             }
         }`);
         const shaker = new TailwindTreeShaker();
         shaker.shake(source);

         const root = {
            '.container': '{width:100%}',
            '@media (min-width:640px)': {
               '.container': '{max-width:640px}'
            },
            '@media (min-width:1024px)': {
               '.lg\\:container': '{width:100%}',
               '@media (min-width:640px)': {
                  '.lg\\:container': '{max-width:640px}'
               }
            }
         };

         expect(shaker.root).deep.equal(root);
         expect(shaker.text).equals(
            '' +
            '.container{width:100%}' +
            '@media (min-width:640px){' +
               '.container{max-width:640px}' +
            '}' +
            '@media (min-width:1024px){' +
               '.lg\\:container{width:100%}' +
               '@media (min-width:640px){' +
                  '.lg\\:container{max-width:640px}' +
               '}' +
            '}'
         );
      });
      it('should keep only top rule', () => {
         const source = (`
         a[title]{ width:100% }
         @media (min-width:640px){
             .container{ max-width:640px }
         }
         @media (min-width:1024px){
             .lg\\:container{ width:100% }
             @media (min-width:640px){
                 .lg\\:container{ max-width:640px }
             }
         }`);
         const snapshot = {
            '@media (min-width:640px)': {
               '.container': '{max-width:640px}'
            },
            '@media (min-width:1024px)': {
               '.lg\\:container': '{width:100%}',
               '@media (min-width:640px)': {
                  '.lg\\:container': '{max-width:640px}'
               }
            }
         };
         const shaker = new TailwindTreeShaker(snapshot);
         shaker.shake(source);

         const root = {
            'a[title]': '{width:100%}'
         };

         expect(shaker.root).deep.equal(root);
         expect(shaker.text).equals(
            'a[title]{width:100%}'
         );
      });
      it('should keep deep rule', () => {
         const source = (`
         .container{ width:100% }
         @media (min-width:640px){
             .container{ max-width:640px }
         }
         @media (min-width:1024px){
             .lg\\:container{ width:100% }
             @media (min-width:640px){
                 li.spacious.elegant{ max-width:640px }
                 #identified { background-color: skyblue }
             }
         }`);
         const snapshot = {
            '.container': '{width:100%}',
            '@media (min-width:640px)': {
               '.container': '{max-width:640px}'
            },
            '@media (min-width:1024px)': {
               '.lg\\:container': '{width:100%}',
               '@media (min-width:640px)': { }
            }
         };
         const shaker = new TailwindTreeShaker(snapshot);
         shaker.shake(source);

         const root = {
            '@media (min-width:1024px)': {
               '@media (min-width:640px)': {
                  'li.spacious.elegant': '{max-width:640px}',
                  '#identified': '{background-color:skyblue}'
               }
            }
         };

         expect(shaker.root).deep.equal(root);
         expect(shaker.text).equals(
            '' +
            '@media (min-width:1024px){' +
               '@media (min-width:640px){' +
                  'li.spacious.elegant{max-width:640px}' +
                  '#identified{background-color:skyblue}' +
               '}' +
            '}'
         );
      });
      it('should not have text', () => {
         const source = (`
         @media (min-width:1024px){
             .lg\\:container{ width:100% }
             @media (min-width:640px){
                 .lg\\:container{ max-width:640px }
             }
         }`);
         const snapshot = {
            '@media (min-width:1024px)': {
               '.lg\\:container': '{width:100%}',
               '@media (min-width:640px)': {
                  '.lg\\:container': '{max-width:640px}'
               }
            }
         };
         const shaker = new TailwindTreeShaker(snapshot);
         shaker.shake(source);

         expect(shaker.root).to.be.undefined;
         expect(shaker.text).to.be.empty;
      });
      it('should parse atrule types', () => {
         const source = (`
         .flex-container > * { padding: 0.3em }
         svg|a { text-decoration: underline solid }
         @charset 'UTF-8';
         @namespace svg url('http://www.w3.org/2000/svg');
         @property --property-name { initial-value: #c0ffee }
         @page :left { margin-top: 4in }
         @page { size: 8.5in 9in }
         @supports (display: flex) {
            .flex-container > * { text-shadow: 0 0 2px blue }
            .flex-container { display: flex }
         }
         @media not all and (hover: hover) {
             abbr::after { content: ' (' attr(title) ')' }
         }
         @layer theme, layout, utilities;
         @layer state {
            .alert { background-color: brown; }
            p { border: medium solid limegreen; }
         }
         @keyframes identifier {
           0% { top: 0 }
           68%, 72% { left: 50px }
           100% { left: 100% }
         }`);
         const shaker = new TailwindTreeShaker();
         shaker.shake(source);

         const root = {
            '.flex-container>*': '{padding:0.3em}',
            'svg|a': '{text-decoration:underline solid}',
            '@charset \'UTF-8\';': null,
            '@namespace svg url(\'http://www.w3.org/2000/svg\');': null,
            '@property --property-name{initial-value:#c0ffee}': null,
            '@page :left{margin-top:4in}': null,
            '@page{size:8.5in 9in}': null,
            '@supports (display:flex)': {
               '.flex-container>*': '{text-shadow:0 0 2px blue}',
               '.flex-container': '{display:flex}'
            },
            '@media not all and (hover:hover)': {
               'abbr::after': '{content:\' (\' attr(title) \')\'}'
            },
            '@layer theme,layout,utilities;': null,
            '@layer state': {
               '.alert': '{background-color:brown}',
               'p': '{border:medium solid limegreen}'
            },
            '@keyframes identifier{0%{top:0}68%,72%{left:50px}100%{left:100%}}': null
         };

         expect(shaker.root).deep.equal(root);
         expect(shaker.text).equals(
            '' +
            '.flex-container>*{padding:0.3em}' +
            'svg|a{text-decoration:underline solid}' +
            '@charset \'UTF-8\';' +
            '@namespace svg url(\'http://www.w3.org/2000/svg\');' +
            '@property --property-name{initial-value:#c0ffee}' +
            '@page :left{margin-top:4in}' +
            '@page{size:8.5in 9in}' +
            '@supports (display:flex){' +
               '.flex-container>*{text-shadow:0 0 2px blue}' +
               '.flex-container{display:flex}' +
            '}' +
            '@media not all and (hover:hover){' +
               'abbr::after{content:\' (\' attr(title) \')\'}' +
            '}' +
            '@layer theme,layout,utilities;' +
            '@layer state{.alert{background-color:brown}p{border:medium solid limegreen}}' +
            '@keyframes identifier{' +
               '0%{top:0}' +
               '68%,72%{left:50px}' +
               '100%{left:100%}' +
            '}'
         );
      });
      it('should process with separated definitions', () => {
         // В качестве source поступает класс, с объединенным телом.
         // Можно засчитывать это только в рамках генерации Tailwind.
         const source = (`
            .a{ width:100%; margin-top:4in }
         `);
         const snapshot = {
            '.a,.b,.c': '{width:100%}',
            '.a': '{margin-top:4in}',
            '.b': '{initial-value:#c0ffee}',
            '.c': '{left:50px}'
         };
         const shaker = new TailwindTreeShaker(snapshot);
         shaker.shake(source);

         expect(shaker.root).to.be.undefined;
         expect(shaker.text).is.empty;
      });
      it('should process with container atrule', () => {
         const source = (`
         @container (min-width:640px){
             .container{ max-width:640px }
         }
         @container (min-width:1024px){
             .lg\\:container{ width:100% }
             @container (min-width:640px){
                 li.spacious.elegant{ max-width:640px }
                 #identified { background-color: skyblue }
             }
         }`);
         const shaker = new TailwindTreeShaker();
         shaker.shake(source);

         const root = {
            '@container (min-width:640px)': {
               '.container': '{max-width:640px}'
            },
            '@container (min-width:1024px)': {
               '.lg\\:container': '{width:100%}',
               '@container (min-width:640px)': {
                  'li.spacious.elegant': '{max-width:640px}',
                  '#identified': '{background-color:skyblue}'
               }
            }
         };

         expect(shaker.root).deep.equal(root);
         expect(shaker.text).equals(
            '' +
            '@container (min-width:640px){' +
               '.container{max-width:640px}' +
            '}' +
            '@container (min-width:1024px){' +
               '.lg\\:container{width:100%}' +
               '@container (min-width:640px){' +
                  'li.spacious.elegant{max-width:640px}' +
                  '#identified{background-color:skyblue}' +
               '}' +
            '}'
         );
      });
      it('should ignore unwanted rule 1', () => {
         const source = (`
         *,::before,::after{
            --tw-translate-x: 0;
            --tw-scale-y: 1;
         }
         .lg\\:container{ width:100% }
         `);
         const shaker = new TailwindTreeShaker();
         shaker.shake(source);

         expect(shaker.root).deep.equal({
            '.lg\\:container': '{width:100%}'
         });
         expect(shaker.text).equals(
            '.lg\\:container{width:100%}'
         );
      });
      it('should ignore unwanted rule 2', () => {
         const source = (`
         ::backdrop {
            --tw-border-spacing-x: 0;
         }
         .lg\\:container{ width:100% }
         `);
         const shaker = new TailwindTreeShaker();
         shaker.shake(source);

         expect(shaker.root).deep.equal({
            '.lg\\:container': '{width:100%}'
         });
         expect(shaker.text).equals(
            '.lg\\:container{width:100%}'
         );
      });
   });

   describe('should merge cached snapshot with generated text', () => {
      it('with non-empty snapshot and empty text', () => {
         // К непустому снимку добавляется пустой текст
         const snapshot = {
            '.container': '{width:100%}',
            '@media (min-width:640px)': {
               '.container': '{max-width:640px}'
            },
            '@media (min-width:1024px)': {
               '.lg\\:container': '{width:100%}',
               '@media (min-width:640px)': {
                  '.lg\\:container': '{max-width:640px}'
               }
            }
         };

         const current = new TailwindTreeShaker();
         current.update(snapshot, '');

         expect(current.text).equal(
            '' +
            '.container{width:100%}' +
            '@media (min-width:640px){' +
               '.container{max-width:640px}' +
            '}' +
            '@media (min-width:1024px){' +
               '.lg\\:container{width:100%}' +
               '@media (min-width:640px){' +
                  '.lg\\:container{max-width:640px}' +
               '}' +
            '}'
         );
         expect(current.root).deep.equal(snapshot);
         expect(current.classSelectors).deep.equal([
            'container',
            'lg:container'
         ]);
      });
      it('with non-empty snapshot and non-empty text without intersections', () => {
         // К непустому снимку добавляется непустой снимок без пересечений
         const source = (`
         @media (min-width:1024px){
             .lg\\:container{ width:100% }
             @media (min-width:640px){
                 .lg\\:container{ max-width:640px }
             }
         }`);
         const snapshot = {
            '.container': '{width:100%}',
            '@media (min-width:640px)': {
               '.container': '{max-width:640px}'
            }
         };

         const current = new TailwindTreeShaker();
         current.update(snapshot, source);

         expect(current.text).equal(
            '' +
            '.container{width:100%}' +
            '@media (min-width:640px){' +
               '.container{max-width:640px}' +
            '}' +
            '@media (min-width:1024px){' +
               '.lg\\:container{width:100%}' +
               '@media (min-width:640px){' +
                  '.lg\\:container{max-width:640px}' +
               '}' +
            '}'
         );
         expect(current.root).deep.equal({
            '.container': '{width:100%}',
            '@media (min-width:1024px)': {
               '.lg\\:container': '{width:100%}',
               '@media (min-width:640px)': {
                  '.lg\\:container': '{max-width:640px}'
               }
            },
            '@media (min-width:640px)': {
               '.container': '{max-width:640px}'
            }
         });
         expect(current.classSelectors).deep.equal([
            'container',
            'lg:container'
         ]);
      });
      it('with non-empty snapshot and non-empty text with intersections', () => {
         // К непустому снимку добавляется непустой текст с пересечениями
         const source = (`
         .b1{ width:100% }
         @media (min-width:640px){
             .b2{ max-width:640px }
         }
         @media (min-width:320px){
             .b3{ max-width:640px }
         }
         @media (min-width:1024px){
             .b4{ width:100% }
             @media (min-width:640px){
                 .b5{ max-width:640px }
             }
             @media (min-width:320px){
                 .b6{ max-width:640px }
             }
         }`);
         const snapshot = {
            '.a1': '{width:100%}',
            '@media (min-width:640px)': {
               '.a2': '{max-width:640px}'
            },
            '@media (min-width:1024px)': {
               '.a3': '{width:100%}',
               '@media (min-width:640px)': {
                  '.a4': '{max-width:640px}'
               }
            }
         };

         const current = new TailwindTreeShaker();
         current.update(snapshot, source);

         expect(current.text).equal(
            '' +
            '.a1{width:100%}' +
            '@media (min-width:640px){' +
               '.a2{max-width:640px}' +
               '.b2{max-width:640px}' +
            '}' +
            '@media (min-width:1024px){' +
               '.a3{width:100%}' +
               '@media (min-width:640px){' +
                  '.a4{max-width:640px}' +
                  '.b5{max-width:640px}' +
               '}' +
               '.b4{width:100%}' +
               '@media (min-width:320px){' +
                  '.b6{max-width:640px}' +
               '}' +
            '}' +
            '.b1{width:100%}' +
            '@media (min-width:320px){' +
               '.b3{max-width:640px}' +
            '}'
         );
         expect(current.root).deep.equal({
            '.a1': '{width:100%}',
            '.b1': '{width:100%}',
            '@media (min-width:1024px)': {
               '.a3': '{width:100%}',
               '.b4': '{width:100%}',
               '@media (min-width:320px)': {
                  '.b6': '{max-width:640px}'
               },
               '@media (min-width:640px)': {
                  '.a4': '{max-width:640px}',
                  '.b5': '{max-width:640px}'
               }
            },
            '@media (min-width:320px)': {
               '.b3': '{max-width:640px}'
            },
            '@media (min-width:640px)': {
               '.a2': '{max-width:640px}',
               '.b2': '{max-width:640px}'
            }
         });
         expect(current.classSelectors).deep.equal([
            'a1',
            'a2',
            'b2',
            'a3',
            'a4',
            'b5',
            'b4',
            'b6',
            'b1',
            'b3',
         ]);
      });
      it('with non-empty snapshot and non-empty text with overrides', () => {
         // К непустому снимку добавляется непустой снимок с переопределениями
         const source = (`
         .container{ width:999% }
         @media (min-width:640px){
             .container{ max-width:999px }
         }
         @media (min-width:1024px){
             .lg\\:container{ width:999% }
             @media (min-width:640px){
                 .lg\\:container{ max-width:999px }
             }
         }`);
         const snapshot = {
            '.container': '{width:100%}',
            '@media (min-width:640px)': {
               '.container': '{max-width:640px}'
            },
            '@media (min-width:1024px)': {
               '.lg\\:container': '{width:100%}',
               '@media (min-width:640px)': {
                  '.lg\\:container': '{max-width:640px}'
               }
            }
         };

         const current = new TailwindTreeShaker();
         current.update(snapshot, source);

         expect(current.text).equal(
            '' +
            '.container{width:999%}' +
            '@media (min-width:640px){' +
               '.container{max-width:999px}' +
            '}' +
            '@media (min-width:1024px){' +
               '.lg\\:container{width:999%}' +
               '@media (min-width:640px){' +
                  '.lg\\:container{max-width:999px}' +
               '}' +
            '}'
         );
         expect(current.root).deep.equal({
            '.container': '{width:999%}',
            '@media (min-width:640px)': {
               '.container': '{max-width:999px}'
            },
            '@media (min-width:1024px)': {
               '.lg\\:container': '{width:999%}',
               '@media (min-width:640px)': {
                  '.lg\\:container': '{max-width:999px}'
               }
            }
         });
         expect(current.classSelectors).deep.equal([
            'container',
            'lg:container'
         ]);
      });
      it('with empty snapshot and empty text', () => {
         // К пустому снимку добавляется пустой текст
         const current = new TailwindTreeShaker();
         current.update({}, '');

         expect(current.text).equal('');
         expect(current.root).deep.equal({ });
         expect(current.classSelectors).deep.equal([]);
      });
      it('with empty snapshot and non-empty text', () => {
         // К пустому снимку добавляется непустой текст
         const source = (`
         .container{ width:100% }
         @media (min-width:640px){
             .container{ max-width:640px }
         }
         @media (min-width:1024px){
             .lg\\:container{ width:100% }
             @media (min-width:640px){
                 .lg\\:container{ max-width:640px }
             }
         }`);
         const current = new TailwindTreeShaker();
         current.update({}, source);

         expect(current.text).equal(
            '' +
            '.container{width:100%}' +
            '@media (min-width:640px){' +
               '.container{max-width:640px}' +
            '}' +
            '@media (min-width:1024px){' +
               '.lg\\:container{width:100%}' +
               '@media (min-width:640px){' +
                  '.lg\\:container{max-width:640px}' +
               '}' +
            '}'
         );
         expect(current.root).deep.equal({
            '.container': '{width:100%}',
            '@media (min-width:640px)': {
               '.container': '{max-width:640px}'
            },
            '@media (min-width:1024px)': {
               '.lg\\:container': '{width:100%}',
               '@media (min-width:640px)': {
                  '.lg\\:container': '{max-width:640px}'
               }
            }
         });
         expect(current.classSelectors).deep.equal([
            'container',
            'lg:container'
         ]);
      });
      it('with non-empty snapshot and the same non-empty text', () => {
         // К непустому снимку добавляется идентичный непустой текст
         const source = (`
         .container{ width:100% }
         @media (min-width:640px){
             .container{ max-width:640px }
         }
         @media (min-width:1024px){
             .lg\\:container{ width:100% }
             @media (min-width:640px){
                 .lg\\:container{ max-width:640px }
             }
         }`);
         const snapshot = {
            '.container': '{width:100%}',
            '@media (min-width:640px)': {
               '.container': '{max-width:640px}'
            },
            '@media (min-width:1024px)': {
               '.lg\\:container': '{width:100%}',
               '@media (min-width:640px)': {
                  '.lg\\:container': '{max-width:640px}'
               }
            }
         };

         const current = new TailwindTreeShaker();
         current.update(snapshot, source);

         expect(current.text).equal(
            '' +
            '.container{width:100%}' +
            '@media (min-width:640px){' +
               '.container{max-width:640px}' +
            '}' +
            '@media (min-width:1024px){' +
               '.lg\\:container{width:100%}' +
               '@media (min-width:640px){' +
                  '.lg\\:container{max-width:640px}' +
               '}' +
            '}'
         );
         expect(current.root).deep.equal(snapshot);
         expect(current.classSelectors).deep.equal([
            'container',
            'lg:container'
         ]);
      });
   });
});

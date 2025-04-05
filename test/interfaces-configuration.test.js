'use strict';

require('./init-test');
const { generateFullEnvironment } = require('./changed-files/helpers');
const { expect } = require('chai');

describe('interfaces configuration', () => {
   describe('features transmitted as string', () => {
      const testFacades = (interfaces) => {
         expect(interfaces.required).to.deep.equal([
            {
               name: 'ModuleWithAPI/test',
               path: 'ModuleWithAPI/test'
            },
            {
               name: 'ModuleWithAPI/test/test123',
               path: 'ModuleWithAPI/test/test123'
            }
         ]);
      };

      it('module has default provider - last in providers order', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  'test',
                  'test/test123'
               ],
               depends: ['ModuleWithAPI']
            }, {
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresProvided: [
                  'test',
                  'test/test123'
               ],
               featuresRequired: [
                  'test',
                  'test/test123'
               ]
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleWithAPI/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleWithAPI/test/test123');
         testFacades(interfaces);
      });

      it('module has default provider - first in providers order', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresProvided: [
                  'test',
                  'test/test123'
               ],
               featuresRequired: [
                  'test',
                  'test/test123'
               ]
            }, {
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  'test',
                  'test/test123'
               ],
               depends: ['ModuleWithAPI']
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleProvider/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleProvider/test/test123');
         testFacades(interfaces);
      });

      it('module doesn\'t have default provider, but has provider after in gulp config', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresRequired: [
                  'test',
                  'test/test123'
               ]
            }, {
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  'test',
                  'test/test123'
               ],
               depends: ['ModuleWithAPI']
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleProvider/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleProvider/test/test123');
         testFacades(interfaces);
      });

      it('module doesn\'t have default provider, but has provider before in gulp config', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  'test',
                  'test/test123'
               ],
               depends: ['ModuleWithAPI']
            }, {
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresRequired: [
                  'test',
                  'test/test123'
               ]
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleProvider/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleProvider/test/test123');
         testFacades(interfaces);
      });
   });

   describe('features transmitted as string and object - compatibility layer', () => {
      const testFacades = (interfaces) => {
         expect(interfaces.required).to.deep.equal([
            {
               name: 'ModuleWithAPI/test',
               path: 'ModuleWithAPI/test'
            },
            {
               name: 'ModuleWithAPI/test/test123',
               path: 'ModuleWithAPI/test/test123'
            }
         ]);
      };

      it('module has default provider - last in providers order', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  'test',
                  {
                     name: 'test/test123'
                  }
               ],
               depends: ['ModuleWithAPI']
            }, {
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresProvided: [
                  'test',
                  {
                     name: 'test/test123'
                  }
               ],
               featuresRequired: [
                  'test',
                  {
                     name: 'test/test123'
                  }
               ]
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleWithAPI/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleWithAPI/test/test123');
         testFacades(interfaces);
      });

      it('module has default provider - first in providers order', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresProvided: [
                  'test',
                  {
                     name: 'test/test123'
                  }
               ],
               featuresRequired: [
                  'test',
                  {
                     name: 'test/test123'
                  }
               ]
            }, {
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  'test',
                  {
                     name: 'test/test123'
                  }
               ],
               depends: ['ModuleWithAPI']
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleProvider/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleProvider/test/test123');
         testFacades(interfaces);
      });

      it('module doesn\'t have default provider, but has provider after in gulp config', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresRequired: [
                  'test',
                  {
                     name: 'test/test123'
                  }
               ]
            }, {
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  'test',
                  {
                     name: 'test/test123'
                  }
               ],
               depends: ['ModuleWithAPI']
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleProvider/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleProvider/test/test123');
         testFacades(interfaces);
      });

      it('module doesn\'t have default provider, but has provider before in gulp config', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  'test',
                  {
                     name: 'test/test123'
                  }
               ],
               depends: ['ModuleWithAPI']
            }, {
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresRequired: [
                  'test',
                  {
                     name: 'test/test123'
                  }
               ]
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleProvider/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleProvider/test/test123');
         testFacades(interfaces);
      });
   });

   describe('features transmitted as object - new format of features', () => {
      const testFacades = (interfaces) => {
         expect(interfaces.required).to.deep.equal([
            {
               name: 'ModuleWithAPI/test',
               path: 'ModuleWithAPI/test'
            },
            {
               name: 'ModuleWithAPI/test/test123',
               path: 'ModuleWithAPI/test/test123'
            }
         ]);
      };

      it('module has default provider - last in providers order', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  {
                     name: 'test'
                  },
                  {
                     name: 'test/test123',
                     path: 'test/test1234'
                  }
               ],
               depends: ['ModuleWithAPI']
            }, {
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresProvided: [
                  {
                     name: 'test'
                  },
                  {
                     name: 'test/test123',
                     path: 'test/test1234'
                  }
               ],
               featuresRequired: [
                  {
                     name: 'test'
                  },
                  {
                     name: 'test/test123'
                  }
               ]
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleWithAPI/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleWithAPI/test/test1234');
         testFacades(interfaces);
      });

      it('module has default provider - first in providers order', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresProvided: [
                  {
                     name: 'test'
                  },
                  {
                     name: 'test/test123',
                     path: 'test/test1234'
                  }
               ],
               featuresRequired: [
                  {
                     name: 'test'
                  },
                  {
                     name: 'test/test123'
                  }
               ]
            }, {
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  {
                     name: 'test'
                  },
                  {
                     name: 'test/test123',
                     path: 'test/test1234'
                  }
               ],
               depends: ['ModuleWithAPI']
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleProvider/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleProvider/test/test1234');
         testFacades(interfaces);
      });

      it('module doesn\'t have default provider, but has provider after in gulp config', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresRequired: [
                  {
                     name: 'test'
                  },
                  {
                     name: 'test/test123'
                  }
               ]
            }, {
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  {
                     name: 'test'
                  },
                  {
                     name: 'test/test123',
                     path: 'test/test1234'
                  }
               ],
               depends: ['ModuleWithAPI']
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleProvider/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleProvider/test/test1234');
         testFacades(interfaces);
      });

      it('module doesn\'t have default provider, but has provider before in gulp config', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  {
                     name: 'test'
                  },
                  {
                     name: 'test/test123',
                     path: 'test/test1234'
                  }
               ],
               depends: ['ModuleWithAPI']
            }, {
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresRequired: [
                  {
                     name: 'test'
                  },
                  {
                     name: 'test/test123'
                  }
               ]
            }]
         };

         const { taskParameters } = await generateFullEnvironment(gulpConfig);
         const interfaces = taskParameters.config.getInterfaces();

         expect(interfaces.provided['ModuleWithAPI/test']).to.be.equal('ModuleProvider/test');
         expect(interfaces.provided['ModuleWithAPI/test/test123']).to.be.equal('ModuleProvider/test/test1234');
         testFacades(interfaces);
      });
   });

   describe('interfaces errors', () => {
      it('should throw error if 2 facades with same custom name', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresRequired: [
                  {
                     name: 'custom_feature',
                     path: 'test/test123'
                  }
               ],
               featuresProvided: [
                  {
                     name: 'custom_feature',
                     path: 'test/test123'
                  }
               ],
               depends: ['ModuleWithAPI']
            }, {
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresProvided: [
                  {
                     name: 'custom_feature',
                     path: 'test/test123'
                  }
               ],
               featuresRequired: [
                  {
                     name: 'custom_feature',
                     path: 'test/test123'
                  }
               ]
            }]
         };

         try {
            await generateFullEnvironment(gulpConfig);
            throw new Error('должны были упасть с критической ошибкой');
         } catch (error) {
            expect(error.message).to.equal('При анализе модулей обнаружены критические ошибки');
         }
      });

      it('should throw error if provider has custom path without feature name', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  {
                     path: 'test/test123'
                  }
               ],
               depends: ['ModuleWithAPI']
            }, {
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresProvided: [
                  {
                     name: 'custom_feature',
                     path: 'test/test123'
                  }
               ],
               featuresRequired: [
                  {
                     name: 'custom_feature',
                     path: 'test/test123'
                  }
               ]
            }]
         };

         try {
            await generateFullEnvironment(gulpConfig);
            throw new Error('должны были упасть с критической ошибкой');
         } catch (error) {
            expect(error.message).to.equal('При анализе модулей обнаружены критические ошибки');
         }
      });

      it('should throw error if facade has custom path without feature name', async() => {
         const gulpConfig = {
            cache: './cache',
            modules: [{
               name: 'ModuleProvider',
               path: './ModuleProvider',
               featuresProvided: [
                  {
                     name: 'custom_feature',
                     path: 'test/test123'
                  }
               ],
               depends: ['ModuleWithAPI']
            }, {
               name: 'ModuleWithAPI',
               path: './ModuleWithAPI',
               featuresProvided: [
                  {
                     name: 'custom_feature',
                     path: 'test/test123'
                  }
               ],
               featuresRequired: [
                  {
                     path: 'test/test123'
                  }
               ]
            }]
         };

         try {
            await generateFullEnvironment(gulpConfig);
            throw new Error('должны были упасть с критической ошибкой');
         } catch (error) {
            expect(error.message).to.equal('При анализе модулей обнаружены критические ошибки');
         }
      });
   });
});

define('Modul/ComponentWithOption', ['js!SBIS3.CORE.Contorol'], function(Contorol) {
   /**
    * @class Modul/ComponentWithOption
    * @extends SBIS3.CORE.Contorol
    * @control
    */
   var ComponentWithOption = Contorol.extend(
      /** @lends Modul/ComponentWithOption.prototype */ {
         $protected: {
            _options: {

               /**
                * @cfg {String}
                * @translatable
                */
               caption: ''
            }
         }
      }
   );
   return ComponentWithOption;
});

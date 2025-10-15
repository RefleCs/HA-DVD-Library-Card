
/* DVD Library Pro Card – v0.2.0 (HACS repo) */
(function(){
  const ELEMENT='dvd-library-pro-card';
  if (!window.customCards) window.customCards=[];
  window.customCards.push({type:ELEMENT,name:'DVD Library Pro Card',description:'Grid/strip of DVDs with Box badge and configurable fields (vertical/horizontal)',preview:true});
  class C extends HTMLElement{setConfig(c){this._c=c;} set hass(h){if(!this._i){this._i=true; this.innerHTML='<ha-card>DVD Library Pro Card</ha-card>';}} static getConfigElement(){return document.createElement('div');} static getStubConfig(){return {entity:'sensor.dvd_library'};}}
  if(!customElements.get(ELEMENT)) customElements.define(ELEMENT,C);
})();

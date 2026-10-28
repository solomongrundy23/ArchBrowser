(()=>{function e(){$(".options_header a")[0].setAttribute("href","chrome-extension://"+chrome.runtime.id+"/options.html")}href="chrome-extension://pgdhemfjokcdecnbhjfinacpjdbeaknm/options.html";const t="custom_options_list",n="use_per_tab";class a{constructor(e,t,n,a,r,s){this.title=e,this.ua_string=t,this.vendor=n,this.badge=a,this.is_preset=r,this.append_to_default_ua=!1,this.group=s,this.is_managed=!1,this.key=""}}function r(){return chrome.storage.local}async function s(){const e=await chrome.storage.local.get("OtherSettings").then((e=>e?.OtherSettings?.spoof_per_tab??null));return null!=e?e:(await chrome.storage.local.get(n))[n]}async function i(){return r().get(t).then((({[t]:e})=>e||[]))}async function o(){return((await chrome.storage.local.get("UserAgents"))?.UserAgents||[]).map(((e,t)=>function({title:e,ua_string:t,vendor:n,badge:r,append:s},i){return Object.assign(new a,{is_managed:!0,title:e,ua_string:t,vendor:n,badge:r,append_to_default_ua:s,group:"Managed",key:void 0!==i?"cm_"+i:void 0})}(e,t)))}async function u(e){return e?(await s()||(e="no_spoof"),(await async function(){return(await chrome.storage.session.get("hotlist"))?.hotlist||{}}())[e]||null):null}function c(e){return e?.group||""}function l(){chrome.tabs.query({currentWindow:!0,active:!0}).then((async([e])=>{const t=await u(e.id);$("td").removeClass("popup_selected"),t&&($("td#ua_row_"+t).addClass("popup_selected"),function(e){return r().get(e).then((({[e]:t})=>t))}(t).then((function(e){$("td#ua_row_"+c(e)).addClass("popup_selected")})))}))}function d(e,t,n,a){let r=e;e.includes("Internet Explorer")&&(r="Internet Explorer"),e.includes("Default")&&(r="Chrome"),(e.includes("iPhone")||e.includes("iPad"))&&(r="iOS"),e.includes("Android")&&(r="Android"),e.includes("Windows")&&(r="Windows"),e.includes("Firefox")&&(r="Firefox"),e.includes("Opera")&&(r="Opera"),e.includes("Safari")&&(r="Safari");var s=document.createElement("tr"),i=document.createElement("td");(o=document.createElement("img")).setAttribute("src",`images/${r}.png`),o.className=`table_row_image ua_row_${a}`,i.appendChild(o),s.appendChild(i),s.setAttribute("class","table_row"),i=document.createElement("td");var o,u=document.createElement("a");return i.className=`popup_item ua_row_${a}`,u.appendChild(document.createTextNode(e)),i.appendChild(u),s.appendChild(i),i.setAttribute("id","ua_row_"+a),n&&(i=document.createElement("td"),(o=document.createElement("img")).setAttribute("src",n),o.setAttribute("class","ua_row_"+a),o.style.cursor="pointer",i.appendChild(o),"images/arrow.png"===n&&(o.setAttribute("class","return_default_view"),o.classList.remove("ua_row_"+a)),s.appendChild(i)),s}function p(e){const t=$("#sub_table_"+e);t.addClass("visible"),t.removeClass("invisible");const n=$("#group_table");n.addClass("invisible"),n.removeClass("visible")}function _(e){var t=$("#options_table");t.empty();var n=document.createElement("table");n.setAttribute("id","group_table"),t.append(n),(n=$("#group_table")).addClass("popup_group_table");var a=0;for(var r in e){n.append(d(""==r?"Default":r,0,"images/Chevron-right.png",a));var s=document.createElement("table");s.setAttribute("id","sub_table_"+a),t.append(s),$(".ua_row_"+a).on("click",function(e){return function(){p(e)}}(a)),(s=$("#sub_table_"+a)).addClass("popup_sub_table");const i=e[r];for(let e=0;e<i.length;e++){s.append(d(i[e].title,i[e].key,"images/arrow.png",""+i[e].key)),s.addClass("invisible");const t=i[e].key;$(".ua_row_"+i[e].key).on("click",(()=>{return e=t,void chrome.runtime.sendMessage({action:"setCurrent",target:"service_worker",ua_index:e},{},l);var e}))}a++}$(".return_default_view").click((e=>{e.preventDefault(),function(){let e=$(".visible")[0];e.removeAttribute("class","visible"),e.className="invisible popup_sub_table",$("#group_table").addClass("visible")}()})),1==a&&p(0),l()}chrome.declarativeNetRequest.MAX_NUMBER_OF_SESSION_RULES,$(window).on("load",(function(){(async function(){const e=await async function(){const[e,t]=await Promise.all([o(),i()]);if(!t||0===t.length)return e;const n=await r().get(t);return e.concat(Object.values(n))}();return Object.fromEntries(Map.groupBy(e,c))})().then(_).then(e)}))})();
// ===== Donate Modal =====
(function() {
  function initDonateModal() {
    const btn = document.getElementById('donate-btn');
    const modal = document.getElementById('donate-modal');
    if (!btn || !modal) return;

    const overlay = modal.querySelector('.donate-modal__overlay');
    const closeBtn = modal.querySelector('.donate-modal__close');
    const amounts = modal.querySelectorAll('.donate-amount');
    const supportBtn = document.getElementById('donate-support-btn');

    let selectedUrl = 'https://www.creem.io/payment/prod_4qDVucIR8AjUcS2qHwqCKx';

    function openModal() {
      modal.hidden = false;
    }
    function closeModal() {
      modal.hidden = true;
    }

    btn.addEventListener('click', openModal);
    if (overlay) overlay.addEventListener('click', closeModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });

    amounts.forEach(function(el) {
      el.addEventListener('click', function() {
        amounts.forEach(function(a) { a.classList.remove('donate-amount--selected'); });
        el.classList.add('donate-amount--selected');
        selectedUrl = el.getAttribute('data-url') || selectedUrl;
      });
    });

    if (supportBtn) {
      supportBtn.addEventListener('click', function() {
        window.open(selectedUrl, '_blank');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDonateModal);
  } else {
    initDonateModal();
  }
})();

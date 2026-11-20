// audit-interact.js — 交互走查 v2：点击关键按钮（评论/收起/展开全文/图片查看器），
// 每步断言布局 + 截图。matcher 用 includes（避免正则转义问题）。
// 用法: node test/audit-interact.js
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('./lib/cdp.js');

const OUT_DIR = path.join(__dirname, '..', '..', '_tmp-shots');

async function snap(api, sid, name) {
  const diag = await cdp.evalJson(api, `JSON.stringify((()=>{
    const SW = parseInt(document.documentElement.style.getPropertyValue('--z2m-w')) || 358;
    const clipped = e => { let a = e.parentElement; while (a && a !== document.body) { const cs = getComputedStyle(a); if (cs.overflowX !== 'visible') { const b = a.getBoundingClientRect(); if (b.right <= SW + 2) return true; } a = a.parentElement; } return false; };
    const over = [...document.querySelectorAll('body *')].filter(e=>{
      const b=e.getBoundingClientRect(); const cs=getComputedStyle(e);
      return b.width>0 && b.right > SW+2 && cs.position!=='fixed' && cs.visibility!=='hidden' && cs.display!=='none' && !e.closest('#z2m-style') && !clipped(e);
    }).slice(0,3).map(e=>e.tagName+'.'+(e.className&&e.className.toString().split(' ').slice(0,2).join('.')));
    const m=document.querySelector('main.App-main');
    const b=m?m.getBoundingClientRect():null;
    return {main: b?[Math.round(b.left),Math.round(b.width)]:null, overflow: over};
  })())`, sid);
  const d = typeof diag === 'string' ? JSON.parse(diag) : diag;
  const shot = path.join(OUT_DIR, `it-${name}.png`);
  const z = parseFloat(String(await cdp.evalJson(api, 'String(document.documentElement.style.zoom || getComputedStyle(document.documentElement).zoom)', sid))) || 1;
  const clip = { x: 0, y: 0, width: Math.round(358 * z), height: Math.round(700 * z), scale: Number((1 / z).toFixed(4)) };
  await api.send('Page.captureScreenshot', { format: 'png', clip }, sid)
    .then(r => fs.writeFileSync(shot, Buffer.from(r.data, 'base64')))
    .catch(() => {});
  return d;
}

// 点击：在页面里按「文本包含」找可见元素并点击
async function clickText(api, sid, text, scope) {
  return cdp.evalJson(api, `JSON.stringify((()=>{
    const norm = s => (s||'').replace(/[\\s\\u200b\\u200c\\u200d\\ufeff]+/g, ' ').trim();
    const root = ${scope ? `document.querySelector('${scope}')` : 'document'};
    if (!root) return {found:false, why:'no scope'};
    const els = [...root.querySelectorAll('button, a, [role=button], span, div')];
    const b = els.find(x => {
      if (x.children.length > 2) return false;
      const t = norm(x.innerText || x.getAttribute('aria-label') || '');
      return t && t.includes('${text}') && t.length < 30;
    });
    if (!b) return {found:false, why:'not found'};
    b.scrollIntoView({block:'center'});
    b.click();
    return {found:true, text:norm(b.innerText||'').slice(0,25)};
  })())`, sid);
}

(async () => {
  const api = await cdp.browserApi();
  let fail = 0;
  try {
    // ===== 场景 1：首页 → 展开评论弹层 → 关闭 =====
    {
      const t = await cdp.findTab(api, 'zhihu.com');
      const sid = await cdp.attach(api, t.targetId);
      await api.send('Page.navigate', { url: 'https://www.zhihu.com/' }, sid);
      await cdp.waitReady(api, sid, 40);
      await cdp.sleep(8000);
      console.log('home:', JSON.stringify(await snap(api, sid, '01-home')));

      let r = await clickText(api, sid, '条评论');
      console.log('click 条评论:', JSON.stringify(r));
      await cdp.sleep(4000);
      const modal = await cdp.evalJson(api, `JSON.stringify({
        open: !!document.querySelector('.Modal-content'),
        rect: (function(){const m=document.querySelector('.Modal-content'); if(!m) return null; const b=m.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)];})()
      })`, sid);
      console.log('modal:', modal);
      console.log('home+modal:', JSON.stringify(await snap(api, sid, '02-home-modal')));

      // 关闭弹层
      r = await clickText(api, sid, '收起评论');
      if (!r.found) {
        // 弹层关闭按钮
        r = await cdp.evalJson(api, `JSON.stringify((()=>{const b=document.querySelector('[aria-label="关闭"]'); if(!b) return {found:false}; b.click(); return {found:true}; })())`, sid);
      }
      console.log('close:', JSON.stringify(r));
      await cdp.sleep(3000);
      const after = await cdp.evalJson(api, 'JSON.stringify({modal: !!document.querySelector(".Modal-content")})', sid);
      console.log('modal after close:', after);
      console.log('home after:', JSON.stringify(await snap(api, sid, '03-home-closed')));
    }

    // ===== 场景 2：问答页 → 展开全文 → 评论弹层 → back 关闭 =====
    {
      const t = await cdp.findTab(api, 'zhihu.com');
      const sid = await cdp.attach(api, t.targetId);
      await api.send('Page.navigate', { url: 'https://www.zhihu.com/question/39261222' }, sid);
      await cdp.waitReady(api, sid, 40);
      await cdp.sleep(8000);
      console.log('question:', JSON.stringify(await snap(api, sid, '10-question')));

      let r = await clickText(api, sid, '阅读全文');
      console.log('阅读全文:', JSON.stringify(r));
      await cdp.sleep(3000);
      console.log('expanded:', JSON.stringify(await snap(api, sid, '11-expanded')));

      r = await clickText(api, sid, '条评论');
      console.log('条评论:', JSON.stringify(r));
      await cdp.sleep(4000);
      const modal = await cdp.evalJson(api, `JSON.stringify({open: !!document.querySelector(".Modal-content"), url: location.href.slice(0,60)})`, sid);
      console.log('modal:', modal);
      console.log('q+modal:', JSON.stringify(await snap(api, sid, '12-q-modal')));

      // history.back 关闭（哨兵机制）
      await api.send('Runtime.evaluate', { expression: 'history.back()', returnByValue: false }, sid);
      await cdp.sleep(3500);
      const after = await cdp.evalJson(api, 'JSON.stringify({modal: !!document.querySelector(".Modal-content"), url: location.href.slice(0,55)})', sid);
      console.log('after back:', after);
      console.log('q after back:', JSON.stringify(await snap(api, sid, '13-q-after-back')));
    }

    // ===== 场景 3：专栏文章 → 图片查看器 =====
    {
      const t = await cdp.findTab(api, 'zhuanlan') || await cdp.findTab(api, 'zhihu.com');
      const sid = await cdp.attach(api, t.targetId);
      await api.send('Page.navigate', { url: 'https://zhuanlan.zhihu.com/p/2088387353136181672' }, sid);
      await cdp.waitReady(api, sid, 40);
      await cdp.sleep(9000);
      console.log('post:', JSON.stringify(await snap(api, sid, '20-post')));

      const r = await cdp.evalJson(api, `JSON.stringify((()=>{
        const img=document.querySelector('.Post-RichText img, .RichText img');
        if(!img) return {found:false};
        img.scrollIntoView({block:'center'});
        setTimeout(()=>img.click(), 300);
        return {found:true};
      })())`, sid);
      console.log('click img:', JSON.stringify(r));
      await cdp.sleep(5000);
      const viewer = await cdp.evalJson(api, `JSON.stringify((()=>{
        const iv=document.querySelector('.ImageView');
        const bodyImg=[...document.body.children].find(e=>e.tagName==='IMG');
        const img = iv ? iv.querySelector('img.ImageView-img') : bodyImg;
        if(!img) return {open:false};
        const b=img.getBoundingClientRect();
        return {open:true, cls: iv?'ImageView':'lightbox', rect:[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)], inView: b.left>=-5 && (b.left+b.width) <= window.innerWidth+5};
      })())`, sid);
      console.log('viewer:', viewer);
      console.log('post+viewer:', JSON.stringify(await snap(api, sid, '21-viewer')));

      await api.send('Runtime.evaluate', { expression: 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",keyCode:27,bubbles:true}))', returnByValue: false }, sid);
      await cdp.sleep(3000);
      console.log('post closed viewer:', JSON.stringify(await snap(api, sid, '22-viewer-closed')));
    }

    console.log('DONE');
  } finally { api.close(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

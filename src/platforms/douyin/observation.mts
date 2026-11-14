import {observationMedia} from '../../life/observation-media.mjs';

export async function sampleVisibleContent(page: any,itemId: string,detail: any) {
 if(!/^\d{6,30}$/.test(itemId)||String(detail?.aweme_id)!==itemId)return;
 const addresses = (list:any) => Array.isArray(list)?list.slice(0,8).filter(url=>
  typeof url==='string'&&url.length<=2000&&url.startsWith('https://')):[];
 const video = addresses(detail.video?.play_addr?.url_list);
 const images = Array.isArray(detail.images)?detail.images.slice(0,4).flatMap(
  image=>addresses(image?.url_list)): [];
 if(!video.length&&!images.length)return;
 try {
  const sample=await page.evaluate(({itemId,video,images})=>{
   if(location.protocol!=='https:'||location.hostname!=='www.douyin.com'||
      !['/video/'+itemId,'/note/'+itemId].includes(location.pathname))return;
   const players=Array.from(document.querySelectorAll('video')).slice(0,8).filter(
    node=>node.readyState>=2&&node.videoWidth>0&&video.includes(node.currentSrc)&&node.getClientRects().length);
   const photo=Array.from(document.images).slice(0,40).find(
    node=>node.complete&&node.naturalWidth>0&&images.includes(node.currentSrc)&&node.getClientRects().length);
   const player=players.length===1?players[0]:undefined;
   const element=player||photo;
   if(!element)return;
   const width=player?player.videoWidth:photo.naturalWidth;
   const height=player?player.videoHeight:photo.naturalHeight;
   const scale=Math.min(1,480/width,360/height);
   const canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.floor(width*scale));
   canvas.height=Math.max(1,Math.floor(height*scale));
   const context=canvas.getContext('2d');
   if(!context)return;
   context.drawImage(element,0,0,canvas.width,canvas.height);
   const data=canvas.toDataURL('image/jpeg',0.65).split(',')[1];
   return {itemId,kind:player?'frames':'images',data,...player?{seconds:Math.round(player.currentTime*100)/100}:{}};
  },{itemId,video,images});
  return observationMedia(sample,itemId);
 }catch{return;}
}


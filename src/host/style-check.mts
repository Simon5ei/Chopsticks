import rules from '../style/vendor/fishrules.cjs';

/** Advisory analysis of one draft. No history, persistence or sending capability. */
export function checkStyle(caller?: any,args?: any){
 if(caller?.role!=='qq'||!/^[gp]:\d+$/.test(caller?.channel||caller?.chatKey||''))throw Error('QQ executor required');
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some((k)=>k!=='text')||typeof args.text!=='string')throw Error('Only draft text is accepted');
 const text=args.text;
 if(text.length>4000||!text.trim())throw Error('Draft must contain 1 to 2000 characters');
 const checkedLength=Array.from(text).length;
 if(checkedLength>2000)throw Error('Draft must contain 1 to 2000 characters');
 const result=rules.score(text,{mode:'check'});
 return {advisory:true,flagged:result.fish,checkedLength,hard:result.hard,soft:result.soft,repeats:result.repeats,historyCompared:false};
}

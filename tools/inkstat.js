const fs=require('fs'), path=require('path');
const E=require(path.join(__dirname,'..','js','engine.js'));
const AI=require(path.join(__dirname,'..','js','ai.js'));
const cards=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','cards.json'),'utf8')).cards;
const N=parseInt(process.argv[2]||'2',10), G=parseInt(process.argv[3]||'200',10), OVER=JSON.parse(process.argv[4]||'{}');
let buys=0,gaths=0,inkEnd=0,inkSpent=0,rounds=0;
for(let i=0;i<G;i++){
  const roster=[]; for(let k=0;k<N;k++) roster.push({name:'P'+k,isAI:true});
  const g=new E.Game(cards,{seed:5000+i*41,eraCount:6,players:roster,config:OVER});
  let guard=0;
  while(!g.state.over&&guard++<400){
    const cur=g.state.current;
    const step=AI.decide(g,cur,'normal');
    if(step.type==='place'){const r=g.place(step.cardId,cur); if(r.ok){buys++;inkSpent+=r.preview.cost;} else {g.gather(cur);gaths++;}}
    else {g.gather(cur);gaths++;}
    if(g.state.over) break;
    g.endTurn();
  }
  inkEnd+=g.state.players.reduce((s,p)=>s+p.ink,0)/N;
  rounds+=g.state.round;
}
console.log(`N=${N} ${JSON.stringify(OVER)} 买/采=${(100*buys/(buys+gaths)).toFixed(1)}% / ${(100*gaths/(buys+gaths)).toFixed(1)}%  终局余墨${(inkEnd/G).toFixed(2)}  每局买${(buys/G).toFixed(1)}张 花墨${(inkSpent/G).toFixed(1)}  轮${(rounds/G).toFixed(2)}`);

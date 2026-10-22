import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
function respond(body: unknown, status = 200, origin = "") { return new Response(JSON.stringify(body), { status, headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } }); }
function pemToDer(pem: string): Uint8Array<ArrayBuffer> { const body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s/g, ""); const binary = atob(body); const bytes = new Uint8Array(new ArrayBuffer(binary.length)); for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i); return bytes; }
function base64Url(bytes: Uint8Array): string { let binary=""; for(let i=0;i<bytes.length;i++) binary+=String.fromCharCode(bytes[i]); return btoa(binary).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_"); }
function base64UrlText(value: string): string { return base64Url(new TextEncoder().encode(value)); }
Deno.serve(async (req: Request) => {
 const origin=req.headers.get("Origin")||"";
 if(req.method==="OPTIONS") return new Response("ok",{headers:{...headers,"Access-Control-Allow-Origin":allowedOrigins.has(origin)?origin:"https://fq-snrg-mma.com","Vary":"Origin"}});
 if(req.method!=="POST") return respond({error:"Method not allowed"},405,origin);
 if(origin&&!allowedOrigins.has(origin)) return respond({error:"Origin not allowed"},403,origin);
 if(!req.headers.get("apikey")) return respond({error:"A public API key is required."},401,origin);
 let input:{event_id?:unknown}; try{input=await req.json()}catch{return respond({error:"Choose a valid free stream event."},400,origin)}
 const eventId=String(input.event_id||"");
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) return respond({error:"Choose a valid stream event."},400,origin);
 const supabaseUrl=Deno.env.get("SUPABASE_URL"), serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), encodedPrivate=Deno.env.get("LIVEPEER_SIGNING_PRIVATE_KEY"), encodedPublic=Deno.env.get("LIVEPEER_SIGNING_PUBLIC_KEY");
 if(!supabaseUrl||!serviceKey||!encodedPrivate||!encodedPublic) return respond({error:"Livepeer playback is not configured."},503,origin);
 const db=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:config,error:configError}=await db.from("event_streams").select("livepeer_playback_id,stream_price_cents,is_enabled,playback_token_ttl_seconds").eq("event_id",eventId).maybeSingle();
 if(configError||!config||!config.is_enabled||!config.livepeer_playback_id) return respond({error:"Free stream access is not enabled for this event."},409,origin);
 if(config.stream_price_cents!==0) return respond({error:"This event is not currently configured for free access."},403,origin);
 const tokenTtlSeconds=Math.max(60,Math.min(600,Number(config.playback_token_ttl_seconds)||600));
 const {data:event,error:eventError}=await db.from("events").select("title,status,is_published").eq("id",eventId).maybeSingle();
 if(eventError||!event||!event.is_published||!["upcoming","live"].includes(event.status)) return respond({error:"This stream is not available right now."},409,origin);
 const playbackId=String(config.livepeer_playback_id); if(!/^[A-Za-z0-9_-]{8,128}$/.test(playbackId)) return respond({error:"The Livepeer playback ID is invalid."},503,origin);
 try{
  const privatePem=atob(encodedPrivate), privateKey=await crypto.subtle.importKey("pkcs8",pemToDer(privatePem),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const now=Math.floor(Date.now()/1000), header={alg:"ES256",typ:"JWT"}, payload={action:"pull",iss:"https://fq-snrg-mma.com",pub:encodedPublic,sub:playbackId,video:"none",exp:now+tokenTtlSeconds,iat:now};
  const signingInput=base64UrlText(JSON.stringify(header))+"."+base64UrlText(JSON.stringify(payload));
  const signature=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},privateKey,new TextEncoder().encode(signingInput)));
  const token=signingInput+"."+base64Url(signature), playbackUrl="https://playback.livepeer.studio/hls/"+encodeURIComponent(playbackId)+"/index.m3u8?jwt="+encodeURIComponent(token);
  return respond({playback_url:playbackUrl,event_title:event.title},200,origin);
 }catch(error){console.error("Free Livepeer playback token creation failed",error instanceof Error?error.message:"unknown error");return respond({error:"Secure free playback could not be initialized."},503,origin)}
});
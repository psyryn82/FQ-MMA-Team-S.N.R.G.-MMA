import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
function respond(body: unknown, status = 200, origin = "") { return new Response(JSON.stringify(body), { status, headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } }); }
Deno.serve(async (req) => {
 const origin=req.headers.get("Origin")||"";
 if(req.method==="OPTIONS") return new Response("ok",{headers:{...headers,"Access-Control-Allow-Origin":allowedOrigins.has(origin)?origin:"https://fq-snrg-mma.com","Vary":"Origin"}});
 if(req.method!=="POST") return respond({error:"Method not allowed"},405,origin);
 if(origin&&!allowedOrigins.has(origin)) return respond({error:"Origin not allowed"},403,origin);
 const supabaseUrl=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),stripeKey=Deno.env.get("STRIPE_SECRET_KEY");
 if(!supabaseUrl||!serviceKey||!stripeKey||!req.headers.get("apikey")) return respond({error:"Media delivery is not configured."},503,origin); const stripeIsLive=stripeKey.startsWith("sk_live_"); if(!stripeIsLive&&!stripeKey.startsWith("sk_test_")) return respond({error:"Stripe is not configured with a valid secret key."},503,origin);
 let input:{media_id?:unknown;buyer_email?:unknown;session_id?:unknown};try{input=await req.json();}catch{return respond({error:"Purchase details are required."},400,origin);}
 const mediaId=Number(input.media_id),email=String(input.buyer_email||"").trim().toLowerCase(),sessionId=String(input.session_id||"").trim();
 if(!Number.isSafeInteger(mediaId)||mediaId<1||email.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return respond({error:"A valid checkout session, purchase email, and media item are required."},400,origin); if((stripeIsLive&&!sessionId.startsWith("cs_live_"))||(!stripeIsLive&&!sessionId.startsWith("cs_test_"))) return respond({error:"Checkout session does not match the configured Stripe mode."},400,origin);
 const stripe=new Stripe(stripeKey,{httpClient:Stripe.createFetchHttpClient()});
 let session:Stripe.Checkout.Session;
 try{session=await stripe.checkout.sessions.retrieve(sessionId);}catch{return respond({error:"Could not verify this Stripe checkout session."},404,origin);}
 if(session.livemode!==stripeIsLive) return respond({error:"Checkout session does not match the configured Stripe mode."},403,origin);
 if(session.mode!=="payment"||session.status!=="complete"||session.payment_status!=="paid"||session.metadata?.purchase_type!=="media"||session.metadata?.media_id!==String(mediaId)) return respond({error:"Stripe has not confirmed payment for this media item."},403,origin);
 const paidEmail=String(session.customer_details?.email||session.customer_email||"").trim().toLowerCase();
 if(!paidEmail||paidEmail!==email) return respond({error:"Use the same email address used at Stripe checkout."},403,origin);
 const db=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:media,error:mediaError}=await db.from("media").select("id,title,file_path,storage_bucket,is_published,price").eq("id",mediaId).eq("is_published",true).maybeSingle();
 if(mediaError||!media||Number(media.price)<=0||!media.file_path||media.storage_bucket!=="fqmma-private") return respond({error:"This media is not configured for private paid delivery."},404,origin);
 const {data:purchase,error:purchaseError}=await db.from("media_purchases").select("id").eq("media_id",mediaId).eq("checkout_session_id",sessionId).eq("customer_email",email).eq("payment_status","paid").maybeSingle();
 if(purchaseError||!purchase) return respond({error:"The payment record is still syncing. Wait a few seconds and try again."},403,origin);
 const {data:signed,error:signedError}=await db.storage.from("fqmma-private").createSignedUrl(media.file_path,900,{download:true});
 if(signedError||!signed?.signedUrl) return respond({error:"The download is temporarily unavailable. Please contact FQ MMA support."},502,origin);
 return respond({url:signed.signedUrl,title:media.title,expires_in:900},200,origin);
});
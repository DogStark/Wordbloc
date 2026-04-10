# WordBloc.xyz Domain Setup Instructions

## Method 1: Vercel Nameservers (Recommended)
1. In Vercel Dashboard → Your Project → Settings → Domains
2. Add domain: wordbloc.xyz
3. Vercel will show you nameservers like:
   - ns1.vercel-dns.com
   - ns2.vercel-dns.com

4. In your domain panel, change nameservers to Vercel's nameservers

## Method 2: DNS Records (Alternative)
If you prefer to keep your current nameservers:

1. In your domain DNS settings, add these records:
   - Type: A, Name: @, Value: 76.76.19.61
   - Type: CNAME, Name: www, Value: cname.vercel-dns.com

## Method 3: Current Redirect (Temporary)
Your current redirect from wordbloc.xyz → www.wordbloc.xyz won't work
because www.wordbloc.xyz doesn't exist yet.

Change it to:
Source: wordbloc.xyz
Destination: https://wordbloc.vercel.app

This will work immediately while you set up the proper DNS.
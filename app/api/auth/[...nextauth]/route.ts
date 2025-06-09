/**
 * NextAuth.js Configuration and Route Handlers
 * 
 * This file sets up authentication using Google OAuth2 with Smart Device Management scope.
 * It handles both GET and POST requests for authentication flows.
 * 
 * Routes:
 * - GET /api/auth/[...nextauth]: Handles sign-in, sign-out, and session checks
 * - POST /api/auth/[...nextauth]: Handles OAuth callbacks and token refresh
 * 
 * Key Components:
 * - GoogleProvider: OAuth2 provider for Google authentication
 * - JWT Callback: Manages token lifecycle and refresh
 * - Session Callback: Ensures access token is available in session
 * 
 * Required Environment Variables:
 * - NEXTAUTH_SECRET: Secret key for JWT encryption
 * - NEXTAUTH_URL: Base URL of the application
 * - GOOGLE_CLIENT_ID: Google OAuth client ID
 * - GOOGLE_CLIENT_SECRET: Google OAuth client secret
 */

import NextAuth, { DefaultSession, AuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    user: {
      id?: string;
    } & DefaultSession['user'];
  }
}

if (!process.env.NEXTAUTH_SECRET) {
  throw new Error('NEXTAUTH_SECRET is not set');
}

if (!process.env.NEXTAUTH_URL) {
  throw new Error('NEXTAUTH_URL is not set');
}

/**
 * Authentication options configuration for NextAuth.js
 * Sets up Google OAuth provider with Smart Device Management scope
 */
export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope: "openid email profile https://www.googleapis.com/auth/sdm.service"
        }
      }
    }),
  ],
  debug: true,
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account, user }) {
      console.log('JWT Callback - Initial:', { 
        hasToken: !!token.accessToken,
        hasAccount: !!account,
        hasUser: !!user
      });
      
      if (account && user) {
        console.log('JWT Callback - New Account:', { 
          access_token: account.access_token?.substring(0, 10) + '...',
          expires_at: account.expires_at,
          refresh_token: account.refresh_token ? 'present' : 'missing'
        });
        
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : Date.now() + 3600 * 1000,
        };
      }

      // Return previous token if the access token has not expired yet
      if (Date.now() < (token.accessTokenExpires as number)) {
        console.log('JWT Callback - Token still valid');
        return token;
      }

      // Access token has expired, try to refresh it
      console.log('JWT Callback - Token expired, attempting refresh');
      try {
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: token.refreshToken as string,
          }),
        });

        const tokens = await response.json();
        console.log('JWT Callback - Refresh response:', { 
          success: response.ok,
          expires_in: tokens.expires_in,
          error: tokens.error
        });

        if (!response.ok) throw tokens;

        return {
          ...token,
          accessToken: tokens.access_token,
          accessTokenExpires: Date.now() + tokens.expires_in * 1000,
        };
      } catch (error) {
        console.error('JWT Callback - Refresh error:', error);
        return { ...token, error: "RefreshAccessTokenError" };
      }
    },
    async session({ session, token }) {
      console.log('Session Callback - Input:', { 
        hasUser: !!session.user,
        hasToken: !!token.accessToken,
        tokenExpires: token.accessTokenExpires
      });
      
      // Ensure the access token is always passed to the session
      session.accessToken = token.accessToken as string;
      
      console.log('Session Callback - Output:', {
        hasUser: !!session.user,
        hasToken: !!session.accessToken
      });
      
      return session;
    }
  },
  pages: {
    signIn: '/',
  },
  session: {
    strategy: 'jwt',
    maxAge: 1 * 60 * 60, // 1 hour
  }
};

/**
 * NextAuth.js handler for both GET and POST requests
 * Exports as both GET and POST to handle all auth-related requests
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST }; 
import axios from 'axios';
import { signOut } from 'next-auth/react';

export async function fetchDevices() {
  try {
    const response = await axios.get('/api/devices');
    
    if (!response.data) {
      throw new Error('No data received from server');
    }

    // Check if re-authentication is required
    if (response.data.requiresReauth) {
      console.log('Re-authentication required:', response.data.details);
      // Sign out and redirect to sign in
      await signOut({ callbackUrl: '/' });
      throw new Error(response.data.details);
    }

    return response.data;
  } catch (error) {
    console.error('Error fetching devices:', error);
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.details || error.response?.data?.error || 'Failed to fetch devices';
      
      // If the error indicates re-authentication is needed
      if (error.response?.data?.requiresReauth) {
        await signOut({ callbackUrl: '/' });
      }
      
      throw new Error(errorMessage);
    }
    throw error;
  }
} 
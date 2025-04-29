import axios from 'axios';

export async function fetchDevices() {
  try {
    const response = await axios.get('/api/devices');
    
    if (!response.data) {
      throw new Error('No data received from server');
    }

    return response.data;
  } catch (error) {
    console.error('Error fetching devices:', error);
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.error || 'Failed to fetch devices');
    }
    throw error;
  }
} 
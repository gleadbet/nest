import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
} from 'chart.js';
import 'chartjs-adapter-date-fns';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
);

interface TemperatureData {
  timestamp: string;
  temperature: number;
  humidity?: number;
}

interface TemperatureGraphProps {
  deviceId: string;
  refreshInterval?: number; // in milliseconds
}

export default function TemperatureGraph({ deviceId, refreshInterval = 300000 }: TemperatureGraphProps) {
  const [data, setData] = useState<TemperatureData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const socketRef = useRef<any>(null);
  const isMountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const lastFetchTimeRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    setIsLoading(true);

    // Initialize socket connection
    const socketInitializer = async () => {
      try {
        await fetch('/api/socket');
        const socket = io();
        socketRef.current = socket;

        socket.on(`device-${deviceId}-update`, (newData: TemperatureData) => {
          if (isMountedRef.current) {
            setData(prevData => {
              const updatedData = [...prevData, newData];
              // Keep only last 24 hours of data
              const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
              return updatedData.filter(d => new Date(d.timestamp) > oneDayAgo);
            });
          }
        });
      } catch (err) {
        console.error('Socket initialization error:', err);
      }
    };

    socketInitializer();

    return () => {
      isMountedRef.current = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [deviceId]);

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      if (!isMountedRef.current) return;

      try {
        const now = Date.now();
        if (now - lastFetchTimeRef.current < 1000) return; // Prevent rapid refetches
        lastFetchTimeRef.current = now;

        const response = await fetch(`/api/devices/${deviceId}/temperature-history`);
        if (response.ok) {
          const history = await response.json();
          if (isMountedRef.current) {
            setData(history);
            retryCountRef.current = 0;
          }
        }
      } catch (error) {
        console.error('Error fetching temperature history:', error);
        retryCountRef.current++;
        
        // Retry with exponential backoff
        if (retryCountRef.current < 5) {
          setTimeout(() => {
            if (isMountedRef.current) {
              fetchData();
            }
          }, Math.min(1000 * Math.pow(2, retryCountRef.current), 10000));
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    fetchData();
    const interval = setInterval(fetchData, refreshInterval);

    return () => {
      clearInterval(interval);
    };
  }, [deviceId, refreshInterval]);

  if (isLoading || data.length === 0) {
    return null; // Don't render anything if there's no data
  }

  const chartData = {
    datasets: [
      {
        label: 'Temperature (°C)',
        data: data.map(d => ({
          x: new Date(d.timestamp),
          y: d.temperature
        })),
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1
      },
      ...(data[0].humidity !== undefined ? [{
        label: 'Humidity (%)',
        data: data.map(d => ({
          x: new Date(d.timestamp),
          y: d.humidity
        })),
        borderColor: 'rgb(153, 102, 255)',
        tension: 0.1
      }] : [])
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'time' as const,
        time: {
          unit: 'hour' as const,
          displayFormats: {
            hour: 'MMM d, HH:mm'
          }
        },
        title: {
          display: true,
          text: 'Time'
        }
      },
      y: {
        beginAtZero: false,
        title: {
          display: true,
          text: 'Value'
        }
      }
    },
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Temperature and Humidity History'
      }
    }
  };

  return (
    <div className="h-48">
      <Line data={chartData} options={options} />
    </div>
  );
} 
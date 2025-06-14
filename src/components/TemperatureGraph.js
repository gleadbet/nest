import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';

// Register Chart.js components
Chart.register(...registerables);

const TemperatureGraph = ({ device, useFahrenheit, timestamp }) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!device) return;

    const ctx = chartRef.current.getContext('2d');
    
    // Destroy existing chart if it exists
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Initialize chart
    chartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Current Temperature',
            data: [],
            borderColor: 'rgb(75, 192, 192)',
            tension: 0.1
          },
          {
            label: 'Target Temperature',
            data: [],
            borderColor: 'rgb(255, 99, 132)',
            tension: 0.1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'minute',
              displayFormats: {
                minute: 'HH:mm:ss'
              }
            },
            title: {
              display: true,
              text: 'Time'
            }
          },
          y: {
            title: {
              display: true,
              text: `Temperature (°${useFahrenheit ? 'F' : 'C'})`
            }
          }
        },
        plugins: {
          title: {
            display: true,
            text: `${device.name} Temperature History`
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const value = context.raw.y;
                return `${context.dataset.label}: ${value.toFixed(1)}°${useFahrenheit ? 'F' : 'C'}`;
              }
            }
          }
        }
      }
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [device.name, useFahrenheit]);

  // Update chart data when new values arrive
  useEffect(() => {
    if (!chartInstance.current || !device || !timestamp) return;

    const formatTemp = (temp) => {
      if (temp === 'N/A' || temp === undefined || temp === null) return null;
      const numTemp = parseFloat(temp);
      if (isNaN(numTemp)) return null;
      return useFahrenheit ? (numTemp * 9/5) + 32 : numTemp;
    };

    const currentTemp = formatTemp(device.currentTemp);
    const targetTemp = formatTemp(device.targetTemp);

    if (currentTemp !== null) {
      chartInstance.current.data.datasets[0].data.push({
        x: new Date(timestamp),
        y: currentTemp
      });
    }

    if (targetTemp !== null) {
      chartInstance.current.data.datasets[1].data.push({
        x: new Date(timestamp),
        y: targetTemp
      });
    }

    // Keep only last 30 minutes of data
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    chartInstance.current.data.datasets.forEach(dataset => {
      dataset.data = dataset.data.filter(point => new Date(point.x) > thirtyMinutesAgo);
    });

    chartInstance.current.update('none'); // Use 'none' mode for better performance
  }, [device.currentTemp, device.targetTemp, timestamp, useFahrenheit]);

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <div style={{ height: '300px' }}>
        <canvas ref={chartRef}></canvas>
      </div>
    </div>
  );
};

export default TemperatureGraph; 
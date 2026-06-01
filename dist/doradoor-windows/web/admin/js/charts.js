/* ============================================
   DoraDoor Admin - Chart.js Configuration
   ============================================ */

const ChartConfig = {
    // Color palette for charts
    colors: [
        '#4fc3f7', '#e94560', '#53d769', '#ffd54f',
        '#bb86fc', '#ff9800', '#26c6da', '#ef5350',
        '#66bb6a', '#ab47bc', '#ff7043', '#42a5f5'
    ],

    // Chart.js global defaults for dark theme
    applyDarkTheme() {
        if (typeof Chart === 'undefined') return;
        Chart.defaults.color = '#a0a0b0';
        Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.06)';
        Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
        Chart.defaults.font.size = 12;
        Chart.defaults.plugins.legend.labels.usePointStyle = true;
        Chart.defaults.plugins.legend.labels.padding = 16;
        Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 52, 96, 0.95)';
        Chart.defaults.plugins.tooltip.titleColor = '#e0e0e0';
        Chart.defaults.plugins.tooltip.bodyColor = '#a0a0b0';
        Chart.defaults.plugins.tooltip.borderColor = 'rgba(255, 255, 255, 0.1)';
        Chart.defaults.plugins.tooltip.borderWidth = 1;
        Chart.defaults.plugins.tooltip.cornerRadius = 6;
        Chart.defaults.plugins.tooltip.padding = 10;
    },

    // Create cost trend line chart
    createCostChart(canvasId, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;

        const ctx = canvas.getContext('2d');

        // Create gradient fill
        const gradient = ctx.createLinearGradient(0, 0, 0, 280);
        gradient.addColorStop(0, 'rgba(79, 195, 247, 0.3)');
        gradient.addColorStop(1, 'rgba(79, 195, 247, 0.01)');

        const chartData = data || [];
        const labels = chartData.map(d => {
            if (d.time) {
                const date = new Date(d.time);
                return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
            }
            return '';
        });
        const costs = chartData.map(d => d.cost || 0);
        const requests = chartData.map(d => d.requests || 0);

        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '费用 ($)',
                        data: costs,
                        borderColor: '#4fc3f7',
                        backgroundColor: gradient,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 2,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#4fc3f7',
                        pointBorderColor: '#4fc3f7',
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: '#4fc3f7',
                        pointHoverBorderWidth: 2,
                        yAxisID: 'y'
                    },
                    {
                        label: '请求数',
                        data: requests,
                        borderColor: '#53d769',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [5, 3],
                        fill: false,
                        tension: 0.4,
                        pointRadius: 2,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#53d769',
                        pointBorderColor: '#53d769',
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: '#53d769',
                        pointHoverBorderWidth: 2,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                if (context.datasetIndex === 0) {
                                    return '费用: $' + (context.parsed.y || 0).toFixed(4);
                                } else {
                                    return '请求: ' + (context.parsed.y || 0);
                                }
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.04)',
                            drawBorder: false
                        },
                        ticks: {
                            maxTicksLimit: 12,
                            maxRotation: 0
                        }
                    },
                    y: {
                        position: 'left',
                        grid: {
                            color: 'rgba(255, 255, 255, 0.04)',
                            drawBorder: false
                        },
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toFixed(2);
                            }
                        },
                        title: {
                            display: true,
                            text: '费用 ($)',
                            color: '#4fc3f7'
                        }
                    },
                    y1: {
                        position: 'right',
                        grid: {
                            drawOnChartArea: false
                        },
                        ticks: {
                            callback: function(value) {
                                return value.toLocaleString();
                            }
                        },
                        title: {
                            display: true,
                            text: '请求数',
                            color: '#53d769'
                        }
                    }
                }
            }
        });

        return chart;
    },

    // Create provider distribution doughnut chart
    createProviderChart(canvasId, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;

        const ctx = canvas.getContext('2d');

        const chartData = data || [];
        const labels = chartData.map(d => d.provider || '未知');
        const requests = chartData.map(d => d.requests || 0);
        const colors = chartData.map((_, i) => this.colors[i % this.colors.length]);

        const chart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: requests,
                    backgroundColor: colors,
                    borderColor: '#0f3460',
                    borderWidth: 2,
                    hoverBorderColor: '#fff',
                    hoverBorderWidth: 2,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 12,
                            font: {
                                size: 11
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const value = context.parsed;
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                const provider = chartData[context.dataIndex];
                                let label = context.label + ': ' + value.toLocaleString() + ' 请求 (' + percentage + '%)';
                                if (provider && provider.cost !== undefined) {
                                    label += ' | 费用: $' + provider.cost.toFixed(4);
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });

        return chart;
    },

    // Update cost chart data
    updateCostChart(chart, data) {
        if (!chart) return;

        const chartData = data || [];
        const labels = chartData.map(d => {
            if (d.time) {
                const date = new Date(d.time);
                return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
            }
            return '';
        });
        const costs = chartData.map(d => d.cost || 0);
        const requests = chartData.map(d => d.requests || 0);

        chart.data.labels = labels;
        chart.data.datasets[0].data = costs;
        chart.data.datasets[1].data = requests;
        chart.update('none');
    },

    // Update provider chart data
    updateProviderChart(chart, data) {
        if (!chart) return;

        const chartData = data || [];
        const labels = chartData.map(d => d.provider || '未知');
        const requests = chartData.map(d => d.requests || 0);
        const colors = chartData.map((_, i) => this.colors[i % this.colors.length]);

        chart.data.labels = labels;
        chart.data.datasets[0].data = requests;
        chart.data.datasets[0].backgroundColor = colors;
        chart.update('none');
    }
};

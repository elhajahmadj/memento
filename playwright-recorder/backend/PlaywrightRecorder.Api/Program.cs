using PlaywrightRecorder.Api.Hubs;
using PlaywrightRecorder.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddSignalR();

var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? new[] { "http://localhost:4200" };

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

builder.Services.AddSingleton<IProjectService, ProjectService>();
builder.Services.AddSingleton<IFileTreeService, FileTreeService>();
builder.Services.AddSingleton<ISolutionParser, SolutionParser>();
builder.Services.AddSingleton<ICodeGenerationService, CodeGenerationService>();
builder.Services.AddSingleton<IRecordingService, RecordingService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseRouting();
app.MapControllers();
app.MapHub<RecordingHub>("/hubs/recording");

app.Run();

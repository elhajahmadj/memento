using Microsoft.AspNetCore.Mvc;
using PlaywrightRecorder.Api.Models;
using PlaywrightRecorder.Api.Services;

namespace PlaywrightRecorder.Api.Controllers;

[ApiController]
[Route("api/recording")]
public class RecordingController : ControllerBase
{
    private readonly IRecordingService _recording;
    private readonly IProjectService _projects;

    public RecordingController(IRecordingService recording, IProjectService projects)
    {
        _recording = recording;
        _projects = projects;
    }

    [HttpPost("start")]
    public async Task<ActionResult<RecordingSessionInfo>> Start([FromBody] StartRecordingRequest req)
    {
        if (_projects.Current is null) return BadRequest("No project loaded.");
        var info = await _recording.StartAsync(req);
        return Ok(info);
    }

    [HttpPost("stop")]
    public async Task<ActionResult<IEnumerable<GeneratedFileResult>>> Stop([FromBody] StopRecordingRequest req)
    {
        if (_projects.Current is null) return BadRequest("No project loaded.");
        var generated = await _recording.StopAsync(req.SessionId, _projects.Current);
        return Ok(generated);
    }
}
